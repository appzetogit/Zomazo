import { useState, useEffect, useRef } from "react"
import { userAPI } from "@store/api"
import {
  getDeliveryAddressMode,
  persistUserLocation,
  readStoredUserLocation,
  setDeliveryAddressMode,
} from "@store/utils/deliveryLocationUtils"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}
const DEFAULT_LOCATION = {
  latitude: null,
  longitude: null,
  city: "Select location",
  state: "",
  area: "",
  address: "Select location",
  formattedAddress: "Select location"
}


// BigDataCloud reverse-geocode is expensive/noisy if many components mount `useLocation()`.
// This module-level guard dedupes concurrent calls + rate-limits starts across the whole app.
const GLOBAL_GEOCODE_MIN_INTERVAL_MS = 60_000
const GLOBAL_GEOCODE_REUSE_DISTANCE_METERS = 75
const geoDistanceMeters = (lat1, lng1, lat2, lng2) => {
  if (
    typeof lat1 !== "number" ||
    typeof lng1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lng2 !== "number"
  ) {
    return Number.POSITIVE_INFINITY
  }
  const latDiff = lat2 - lat1
  const lngDiff = lng2 - lng1
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320
}

let globalReverseGeocodeInFlight = null
let globalReverseGeocodeLastStartAt = 0
let globalReverseGeocodeLastCoords = { latitude: null, longitude: null }
let globalReverseGeocodeLastSuccess = null

// Default behavior: resolve from cache/DB quickly, and when permission is already granted
// keep a live geolocation watch so zone/location updates react without page refresh.
const AUTO_START_LIVE_WATCH = true

const reverseGeocodeDirect = async (latitude, longitude) => {
  const now = Date.now()
  const movedMeters = geoDistanceMeters(
    globalReverseGeocodeLastCoords.latitude,
    globalReverseGeocodeLastCoords.longitude,
    latitude,
    longitude
  )
  const timeSinceLastStart = now - globalReverseGeocodeLastStartAt

  // If we recently geocoded a nearby point, reuse the last successful payload (no network).
  if (
    globalReverseGeocodeLastSuccess &&
    movedMeters < GLOBAL_GEOCODE_REUSE_DISTANCE_METERS &&
    timeSinceLastStart < GLOBAL_GEOCODE_MIN_INTERVAL_MS
  ) {
    return globalReverseGeocodeLastSuccess
  }

  // If another caller is already fetching, wait for it when it's "close enough".
  if (globalReverseGeocodeInFlight) {
    const inFlightMoved = geoDistanceMeters(
      globalReverseGeocodeLastCoords.latitude,
      globalReverseGeocodeLastCoords.longitude,
      latitude,
      longitude
    )
    if (inFlightMoved < GLOBAL_GEOCODE_REUSE_DISTANCE_METERS) {
      try {
        return await globalReverseGeocodeInFlight
      } catch {
        // fall through to a fresh attempt
      }
    }
  }

  globalReverseGeocodeLastStartAt = now
  globalReverseGeocodeLastCoords = { latitude, longitude }

  const run = (async () => {
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 3000) // Faster timeout

      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
        { signal: controller.signal }
      )

      const data = await res.json()

      const value = {
        city: data.city || data.locality || "Unknown City",
        state: data.principalSubdivision || "",
        country: data.countryName || "",
        area: data.subLocality || data.neighbourhood || data.locality || "",
        address:
          data.formattedAddress ||
          data.address ||
          `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        formattedAddress:
          data.formattedAddress ||
          data.address ||
          `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      }

      globalReverseGeocodeLastSuccess = value
      return value
    } catch {
      const fallback = {
        city: "Current Location",
        address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        formattedAddress: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      }
      // Don't cache failures as "success" (keeps retries possible), but still return something usable.
      return fallback
    } finally {
      globalReverseGeocodeInFlight = null
    }
  })()

  globalReverseGeocodeInFlight = run
  return run
}

export function useLocation() {
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [permissionGranted, setPermissionGranted] = useState(false)

  const watchIdRef = useRef(null)
  const updateTimerRef = useRef(null)
  const prevLocationCoordsRef = useRef({ latitude: null, longitude: null })
  const lastGeocodeAtRef = useRef(0)
  const lastGeocodedCoordsRef = useRef({ latitude: null, longitude: null })
  const lastResolvedAddressRef = useRef(null)
  const lastDbLocationFetchAtRef = useRef(0)
  const lastDbLocationRef = useRef(null)
  const lastDbUpdateAtRef = useRef(0)
  const lastDbUpdatedCoordsRef = useRef({ latitude: null, longitude: null })

  const GEOCODE_REUSE_DISTANCE_METERS = 120
  const GEOCODE_REUSE_TIME_MS = 10 * 60 * 1000
  const DB_LOCATION_FETCH_TTL_MS = 2 * 60 * 1000
  const DB_UPDATE_MIN_DISTANCE_METERS = 30
  const DB_UPDATE_MIN_INTERVAL_MS = 90 * 1000
  const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    if (
      typeof lat1 !== "number" ||
      typeof lng1 !== "number" ||
      typeof lat2 !== "number" ||
      typeof lng2 !== "number"
    ) {
      return Number.POSITIVE_INFINITY
    }
    const latDiff = lat2 - lat1
    const lngDiff = lng2 - lng1
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320
  }

  /* ===================== DB UPDATE (LIVE LOCATION TRACKING) ===================== */
  const updateLocationInDB = async (locationData) => {
    try {
      // Check if location has placeholder values - don't save placeholders
      const hasPlaceholder =
        locationData?.city === "Current Location" ||
        locationData?.address === "Select location" ||
        locationData?.formattedAddress === "Select location" ||
        (!locationData?.city && !locationData?.address && !locationData?.formattedAddress);

      if (hasPlaceholder) {
        debugLog("?? Skipping DB update - location contains placeholder values:", {
          city: locationData?.city,
          address: locationData?.address,
          formattedAddress: locationData?.formattedAddress
        });
        return;
      }

      // Check if user is authenticated before trying to update DB
      const userToken = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken')
      if (!userToken || userToken === 'null' || userToken === 'undefined') {
        // User not logged in - skip DB update, just use localStorage
        debugLog("?? User not authenticated, skipping DB update (using localStorage only)")
        return
      }

      const dbUpdateDistanceMeters = getDistanceMeters(
        lastDbUpdatedCoordsRef.current.latitude,
        lastDbUpdatedCoordsRef.current.longitude,
        locationData.latitude,
        locationData.longitude
      )
      const dbUpdateAgeMs = Date.now() - lastDbUpdateAtRef.current
      const shouldSkipDbUpdate =
        dbUpdateDistanceMeters < DB_UPDATE_MIN_DISTANCE_METERS &&
        dbUpdateAgeMs < DB_UPDATE_MIN_INTERVAL_MS
      if (shouldSkipDbUpdate) {
        debugLog("Skipping DB update (small movement + recent update):", {
          dbUpdateDistanceMeters: dbUpdateDistanceMeters.toFixed(1),
          dbUpdateAgeMs
        })
        return
      }

      // Prepare complete location data for database storage
      const locationPayload = {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        address: locationData.address || "",
        city: locationData.city || "",
        state: locationData.state || "",
        area: locationData.area || "",
        formattedAddress: locationData.formattedAddress || locationData.address || "",
      }

      // Add optional fields if available
      if (locationData.accuracy !== undefined && locationData.accuracy !== null) {
        locationPayload.accuracy = locationData.accuracy
      }
      if (locationData.postalCode) {
        locationPayload.postalCode = locationData.postalCode
      }
      if (locationData.street) {
        locationPayload.street = locationData.street
      }
      if (locationData.streetNumber) {
        locationPayload.streetNumber = locationData.streetNumber
      }

      debugLog("?? Updating live location in database:", {
        coordinates: `${locationPayload.latitude}, ${locationPayload.longitude}`,
        formattedAddress: locationPayload.formattedAddress,
        city: locationPayload.city,
        area: locationPayload.area,
        accuracy: locationPayload.accuracy
      })

      await userAPI.updateLocation(locationPayload)
      lastDbUpdatedCoordsRef.current = {
        latitude: locationPayload.latitude,
        longitude: locationPayload.longitude
      }
      lastDbUpdateAtRef.current = Date.now()

      debugLog("? Live location successfully stored in database")
    } catch (err) {
      // Only log non-network and non-auth errors
      if (err.code !== "ERR_NETWORK" && err.response?.status !== 404 && err.response?.status !== 401) {
        debugError("? DB location update error:", err)
      } else if (err.response?.status === 404 || err.response?.status === 401) {
        // 404 or 401 means user not authenticated or route doesn't exist
        // Silently skip - this is expected for non-authenticated users
        debugLog("?? Location update skipped (user not authenticated or route not available)")
      }
    }
  }

  // Prefer Google Maps Geocoding API for address accuracy, fallback to existing reverse-geocode.
  let cachedGoogleMapsApiKey = null
  const getGoogleMapsApiKeySafe = async () => {
    if (cachedGoogleMapsApiKey) return cachedGoogleMapsApiKey
    try {
      const { getGoogleMapsApiKey } = await import("@store/utils/googleMapsApiKey.js")
      const key = await getGoogleMapsApiKey()
      if (key && typeof key === "string") {
        cachedGoogleMapsApiKey = key
        return key
      }
    } catch {
      // Ignore key lookup errors; caller will fallback.
    }
    return null
  }

  const reverseGeocodeWithGoogleMaps = async (latitude, longitude, _options = {}) => {
    try {
      const apiKey = await getGoogleMapsApiKeySafe()
      if (!apiKey) {
        return reverseGeocodeDirect(latitude, longitude)
      }

      const controller = new AbortController()
      setTimeout(() => controller.abort(), 6000)
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}&key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, { signal: controller.signal })
      const data = await res.json()
      const result = Array.isArray(data?.results) ? data.results[0] : null
      if (!result) {
        return reverseGeocodeDirect(latitude, longitude)
      }

      const components = Array.isArray(result.address_components) ? result.address_components : []
      const pick = (...types) =>
        components.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""

      const area =
        pick("sublocality_level_1", "sublocality", "neighborhood") ||
        pick("locality")
      const city = pick("locality") || pick("administrative_area_level_2") || "Unknown City"
      const state = pick("administrative_area_level_1")
      const country = pick("country")

      return {
        city,
        state,
        country,
        area,
        address: result.formatted_address || `${city}, ${state}`.trim(),
        formattedAddress: result.formatted_address || `${city}, ${state}`.trim(),
      }
    } catch {
      return reverseGeocodeDirect(latitude, longitude)
    }
  }


  const fetchLocationFromDB = async () => {
    try {
      // Check if user is authenticated before trying to fetch from DB
      const userToken = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken')
      if (!userToken || userToken === 'null' || userToken === 'undefined') {
        // User not logged in - skip DB fetch, return null to use localStorage
        return null
      }

      const dbLocationAgeMs = Date.now() - lastDbLocationFetchAtRef.current
      if (lastDbLocationRef.current && dbLocationAgeMs < DB_LOCATION_FETCH_TTL_MS) {
        return lastDbLocationRef.current
      }

      // There is no stored "current location" on the server; the customer's
      // default saved address (GET /user/addresses) is the closest thing.
      const res = await userAPI.getAddresses()
      const addresses = res?.data?.data?.addresses || res?.data?.addresses || []
      const saved = (Array.isArray(addresses) ? addresses : []).find((a) => a?.isDefault) || addresses?.[0]
      const coords = Array.isArray(saved?.location?.coordinates) ? saved.location.coordinates : null
      const loc = saved
        ? {
            latitude: Number(saved.latitude ?? coords?.[1]) || null,
            longitude: Number(saved.longitude ?? coords?.[0]) || null,
            city: saved.city || "",
            state: saved.state || "",
            area: saved.area || saved.additionalDetails || "",
            address: [saved.street, saved.city, saved.state].filter(Boolean).join(", "),
            formattedAddress: saved.formattedAddress || [saved.street, saved.additionalDetails, saved.city, saved.state, saved.zipCode].filter(Boolean).join(", "),
          }
        : null
      if (loc?.latitude && loc?.longitude) {
        // Validate coordinates are in India range BEFORE attempting geocoding
        const isInIndiaRange = loc.latitude >= 6.5 && loc.latitude <= 37.1 && loc.longitude >= 68.7 && loc.longitude <= 97.4 && loc.longitude > 0

        if (!isInIndiaRange || loc.longitude < 0) {
          // Coordinates are outside India - return placeholder
          debugWarn("?? Coordinates from DB are outside India range:", { latitude: loc.latitude, longitude: loc.longitude })
          const outOfRangeLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            ...DEFAULT_LOCATION,
          }
          lastDbLocationRef.current = outOfRangeLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return outOfRangeLocation
        }

        const hasUsableStoredAddress =
          (loc.formattedAddress && loc.formattedAddress !== "Select location") ||
          (loc.address && loc.address !== "Select location") ||
          (loc.city && loc.city !== "Current Location")

        if (hasUsableStoredAddress) {
          const storedLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            city: loc.city || "Current Location",
            area: loc.area || "",
            state: loc.state || "",
            country: loc.country || "",
            address: loc.address || loc.formattedAddress || DEFAULT_LOCATION.address,
            formattedAddress: loc.formattedAddress || loc.address || DEFAULT_LOCATION.formattedAddress
          }
          lastDbLocationRef.current = storedLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return storedLocation
        }

        try {
          const addr = await reverseGeocodeWithGoogleMaps(
            loc.latitude,
            loc.longitude,
            { includePlaceDetails: false }
          )
          const resolvedLocation = { ...addr, latitude: loc.latitude, longitude: loc.longitude }
          lastDbLocationRef.current = resolvedLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return resolvedLocation
        } catch (geocodeErr) {
          // If reverse geocoding fails, return location without coordinates in address
          debugWarn("?? Reverse geocoding failed in fetchLocationFromDB:", geocodeErr.message)
          const fallbackLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            ...DEFAULT_LOCATION,
          }
          lastDbLocationRef.current = fallbackLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return fallbackLocation
        }
      }
    } catch (err) {
      // Silently fail for 404/401 (user not authenticated) or network errors
      if (err.code !== "ERR_NETWORK" && err.response?.status !== 404 && err.response?.status !== 401) {
        debugError("DB location fetch error:", err)
      }
    }
    return null
  }

  /* ===================== MAIN LOCATION ===================== */
  const getLocation = async (updateDB = true, forceFresh = false, showLoading = false) => {
    // If not forcing fresh, try DB first (faster)
    let dbLocation = !forceFresh ? await fetchLocationFromDB() : null
    if (dbLocation && !forceFresh) {
      setLocation(dbLocation)
      if (showLoading) setLoading(false)
      return dbLocation
    }

    if (!navigator.geolocation) {
      setError("Geolocation not supported")
      if (showLoading) setLoading(false)
      return dbLocation
    }

    // Helper function to get position with retry mechanism
    const getPositionWithRetry = (options, retryCount = 0) => {
      return new Promise((resolve, reject) => {
        const isRetry = retryCount > 0
        debugLog(`?? Requesting location${isRetry ? ' (retry with lower accuracy)' : ' (high accuracy)'}...`)
        debugLog(`?? Force fresh: ${forceFresh ? 'YES' : 'NO'}, maximumAge: ${options.maximumAge || (forceFresh ? 0 : 60000)}`)

        // Use cached location if available and not too old (faster response)
        // If forceFresh is true, don't use cache (maximumAge: 0)
        const cachedOptions = {
          ...options,
          maximumAge: forceFresh ? 0 : (options.maximumAge || 60000), // If forceFresh, get fresh location
        }

        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const { latitude, longitude, accuracy } = pos.coords
              const timestamp = pos.timestamp || Date.now()

              debugLog(`? Got location${isRetry ? ' (lower accuracy)' : ' (high accuracy)'}:`, {
                latitude,
                longitude,
                accuracy: `${accuracy}m`,
                timestamp: new Date(timestamp).toISOString(),
                coordinates: `${latitude.toFixed(8)}, ${longitude.toFixed(8)}`
              })

              // Validate coordinates are in India range BEFORE attempting geocoding
              // India: Latitude 6.5 to 37.1 N, Longitude 68.7 to 97.4 E
              const isInIndiaRange = latitude >= 6.5 && latitude <= 37.1 && longitude >= 68.7 && longitude <= 97.4 && longitude > 0

              // Reverse geocode (BigDataCloud via reverseGeocodeWithGoogleMaps wrapper)
              let addr
              if (!isInIndiaRange || longitude < 0) {
                // Coordinates are outside India - skip geocoding and use placeholder
                debugWarn("?? Coordinates outside India range, skipping geocoding:", { latitude, longitude })
                addr = {
                  ...DEFAULT_LOCATION,
                }
              } else {
                debugLog("?? Calling reverse geocode with coordinates:", { latitude, longitude })
                try {
                  addr = await reverseGeocodeWithGoogleMaps(latitude, longitude, {
                    includePlaceDetails: Boolean(forceFresh && showLoading)
                  })
                  debugLog("? Reverse geocoding successful:", addr)
                } catch (geocodeErr) {
                  debugWarn("?? Primary geocoding failed, trying fallback:", geocodeErr.message)
                  try {
                    // Fallback to direct reverse geocode (BigDataCloud)
                    addr = await reverseGeocodeDirect(latitude, longitude)
                    debugLog("? Fallback geocoding successful:", addr)

                    // Validate fallback result - if it still has placeholder values, don't use it
                    if (addr.city === "Current Location" || addr.address.includes(latitude.toFixed(4))) {
                      debugWarn("?? Fallback geocoding returned placeholder, will not save")
                      addr = {
                        ...DEFAULT_LOCATION,
                      }
                    }
                  } catch (fallbackErr) {
                    debugError("? All geocoding methods failed:", fallbackErr.message)
                    addr = {
                      ...DEFAULT_LOCATION,
                    }
                  }
                }
              }
              debugLog("Reverse geocode result:", addr)
              if (addr?.formattedAddress && addr.formattedAddress !== "Select location") {
                lastResolvedAddressRef.current = addr
                lastGeocodedCoordsRef.current = { latitude, longitude }
                lastGeocodeAtRef.current = Date.now()
              }
              // Ensure we don't use coordinates as address if we have area/city
              // Keep the complete formattedAddress from geocoder when available
              const completeFormattedAddress = addr.formattedAddress || "";
              let displayAddress = addr.address || "";

              // If address contains coordinates pattern, use area/city instead
              const isCoordinatesPattern = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(displayAddress.trim());
              if (isCoordinatesPattern) {
                if (addr.area && addr.area.trim() !== "") {
                  displayAddress = addr.area;
                } else if (addr.city && addr.city.trim() !== "" && addr.city !== "Unknown City") {
                  displayAddress = addr.city;
                }
              }

              // Build location object with ALL fields from reverse geocoding
              const finalLoc = {
                ...addr, // This includes: city, state, area, street, streetNumber, postalCode, formattedAddress
                latitude,
                longitude,
                accuracy: accuracy || null,
                address: displayAddress, // Locality parts for navbar display
                formattedAddress: completeFormattedAddress || addr.formattedAddress || displayAddress // Complete detailed address
              }

              // Check if location has placeholder values - don't save placeholders
              const hasPlaceholder =
                finalLoc.city === "Current Location" ||
                finalLoc.address === "Select location" ||
                finalLoc.formattedAddress === "Select location" ||
                (!finalLoc.city && !finalLoc.address && !finalLoc.formattedAddress && !finalLoc.area);

              if (hasPlaceholder) {
                debugWarn("?? Geocoding returned placeholder — persisting GPS coords only:", finalLoc)
                const coordOnlyLoc = {
                  latitude,
                  longitude,
                  accuracy: accuracy || null,
                  city: finalLoc.city,
                  address: finalLoc.address,
                  formattedAddress: finalLoc.formattedAddress,
                }
                persistUserLocation(coordOnlyLoc)
                setLocation(coordOnlyLoc)
                setPermissionGranted(true)
                if (showLoading) setLoading(false)
                setError(null)
                resolve(coordOnlyLoc)
                return
              }

              debugLog("?? Saving location:", finalLoc)
              localStorage.setItem("userLocation", JSON.stringify(finalLoc))
              setLocation(finalLoc)
              setPermissionGranted(true)
              if (showLoading) setLoading(false)
              setError(null)

              if (updateDB) {
                await updateLocationInDB(finalLoc).catch(err => {
                  debugWarn("Failed to update location in DB:", err)
                })
              }
              resolve(finalLoc)
            } catch (err) {
              debugError("? Error processing location:", err)
              // Try one more time with direct reverse geocode as last resort
              const { latitude, longitude } = pos.coords

              try {
                debugLog("?? Last attempt: trying direct reverse geocode...")
                const lastResortAddr = await reverseGeocodeDirect(latitude, longitude)

                // Check if we got valid data (not just coordinates)
                if (lastResortAddr &&
                  lastResortAddr.city !== "Current Location" &&
                  !lastResortAddr.address.includes(latitude.toFixed(4)) &&
                  lastResortAddr.formattedAddress &&
                  !lastResortAddr.formattedAddress.includes(latitude.toFixed(4))) {
                  const lastResortLoc = {
                    ...lastResortAddr,
                    latitude,
                    longitude,
                    accuracy: pos.coords.accuracy || null
                  }
                  debugLog("? Last resort geocoding succeeded:", lastResortLoc)
                  localStorage.setItem("userLocation", JSON.stringify(lastResortLoc))
                  setLocation(lastResortLoc)
                  setPermissionGranted(true)
                  if (showLoading) setLoading(false)
                  setError(null)
                  if (updateDB) await updateLocationInDB(lastResortLoc).catch(() => { })
                  resolve(lastResortLoc)
                  return
                } else {
                  debugWarn("?? Last resort geocoding returned invalid data:", lastResortAddr)
                }
              } catch (lastErr) {
                debugError("? Last resort geocoding also failed:", lastErr.message)
              }

              // If all geocoding fails, use placeholder but don't save
              const fallbackLoc = {
                latitude,
                longitude,
                ...DEFAULT_LOCATION,
              }
              // Don't save placeholder values to localStorage
              // Only set in state for display
              debugWarn("?? Skipping save - all geocoding failed, using placeholder")
              setLocation(fallbackLoc)
              setPermissionGranted(true)
              if (showLoading) setLoading(false)
              // Don't try to update DB with placeholder
              resolve(fallbackLoc)
            }
          },
          async (err) => {
            // If timeout and we haven't retried yet, try with lower accuracy
            if (err.code === 3 && retryCount === 0 && options.enableHighAccuracy) {
              debugWarn("?? High accuracy timeout, retrying with lower accuracy...")
              getPositionWithRetry({
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: forceFresh ? 0 : 300000,
              }, 1).then(resolve).catch(reject)
              return
            }

            // Don't log timeout errors as errors - they're expected in some cases
            if (err.code === 3) {
              debugWarn("?? Geolocation timeout (code 3) - using fallback location")
            } else {
              debugError("? Geolocation error:", err.code, err.message)
            }
            // When user explicitly asked for fresh GPS, don't fall back to stale DB/cache.
            if (forceFresh) {
              debugWarn("?? Fresh GPS request failed — not using stale fallback")
              setLocation(null)
              setError(err.code === 3 ? "Location request timed out. Please try again." : err.message)
              setPermissionGranted(false)
              if (showLoading) setLoading(false)
              resolve(null)
              return
            }

            // Try multiple fallback strategies
            try {
              // Strategy 1: Use DB location if available
              let fallback = dbLocation
              if (!fallback) {
                fallback = await fetchLocationFromDB()
              }

              // Strategy 2: Use cached location from localStorage
              if (!fallback) {
                const stored = localStorage.getItem("userLocation")
                if (stored) {
                  try {
                    fallback = JSON.parse(stored)
                    debugLog("? Using cached location from localStorage")
                  } catch (parseErr) {
                    debugWarn("?? Failed to parse stored location:", parseErr)
                  }
                }
              }

              if (fallback) {
                debugLog("? Using fallback location:", fallback)
                setLocation(fallback)
                // Don't set error for timeout when we have fallback
                if (err.code !== 3) {
                  setError(err.message)
                }
                setPermissionGranted(true) // Still grant permission if we have location
                if (showLoading) setLoading(false)
                resolve(fallback)
              } else {
                // No fallback available: keep location unset instead of forcing an inaccurate city.
                debugWarn("?? No fallback location available, keeping location unset")
                setLocation(null)
                setError(err.code === 3 ? "Location request timed out. Please try again." : err.message)
                setPermissionGranted(false)
                if (showLoading) setLoading(false)
                resolve(null)
              }
            } catch (fallbackErr) {
              debugWarn("?? Fallback retrieval failed:", fallbackErr)
              setLocation(null)
              setError(err.code === 3 ? "Location request timed out. Please try again." : err.message)
              setPermissionGranted(false)
              if (showLoading) setLoading(false)
              resolve(null)
            }
          },
          options
        )
      })
    }

    // Try with high accuracy first
    // If forceFresh is true, don't use cached location (maximumAge: 0)
    // Otherwise, allow cached location for faster response
    return getPositionWithRetry({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: forceFresh ? 0 : 60000,
    })
  }

  /* ===================== WATCH LOCATION ===================== */
  const startWatchingLocation = () => {
    if (!navigator.geolocation) {
      debugWarn("?? Geolocation not supported")
      return
    }

    // Clear any existing watch
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }

    debugLog("?? Starting to watch location for live updates...")

    let retryCount = 0
    const maxRetries = 2

    const startWatch = (options) => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          try {
            if (getDeliveryAddressMode() === "saved") {
              return
            }

            const { latitude, longitude, accuracy } = pos.coords
            debugLog("?? Location updated:", { latitude, longitude, accuracy: `${accuracy}m` })
            retryCount = 0

            const isInIndiaRange = latitude >= 6.5 && latitude <= 37.1 && longitude >= 68.7 && longitude <= 97.4 && longitude > 0

            let addr
            if (!isInIndiaRange || longitude < 0) {
              debugWarn("?? Coordinates outside India range; skipping reverse geocoding:", { latitude, longitude })
              addr = {
                ...DEFAULT_LOCATION,
              }
            } else {
              const lastAddr = lastResolvedAddressRef.current
              const addressDriftMeters =
                lastAddr?.latitude && lastAddr?.longitude
                  ? getDistanceMeters(lastAddr.latitude, lastAddr.longitude, latitude, longitude)
                  : Number.POSITIVE_INFINITY

              if (
                addressDriftMeters > 200 &&
                Date.now() - lastGeocodeAtRef.current > 15_000
              ) {
                try {
                  addr = await reverseGeocodeWithGoogleMaps(latitude, longitude, {
                    includePlaceDetails: false,
                  })
                  if (addr?.formattedAddress && addr.formattedAddress !== "Select location") {
                    lastResolvedAddressRef.current = { ...addr, latitude, longitude }
                    lastGeocodeAtRef.current = Date.now()
                  }
                } catch {
                  addr = lastAddr || { ...DEFAULT_LOCATION }
                }
              } else if (
                lastAddr?.formattedAddress &&
                lastAddr.formattedAddress !== "Select location"
              ) {
                addr = lastAddr
              } else {
                addr = { ...DEFAULT_LOCATION }
              }
            }

            let completeFormattedAddress = addr.formattedAddress || "";
            let displayAddress = addr.address || "";

            const isFormattedAddressCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(completeFormattedAddress.trim());
            const isDisplayAddressCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(displayAddress.trim());

            if (isFormattedAddressCoordinates || !completeFormattedAddress || completeFormattedAddress === "Select location") {
              const addressParts = [];
              if (addr.area && addr.area.trim() !== "") {
                addressParts.push(addr.area);
              }
              if (addr.city && addr.city.trim() !== "") {
                addressParts.push(addr.city);
              }
              if (addr.state && addr.state.trim() !== "") {
                addressParts.push(addr.state);
              }

              if (addressParts.length > 0) {
                completeFormattedAddress = addressParts.join(', ');
                displayAddress = addr.area || addr.city || DEFAULT_LOCATION.address;
              } else {
                completeFormattedAddress = addr.city || DEFAULT_LOCATION.formattedAddress;
                displayAddress = addr.city || DEFAULT_LOCATION.address;
              }
            }

            if (isDisplayAddressCoordinates) {
              displayAddress = addr.area || addr.city || DEFAULT_LOCATION.address;
            }

            let loc = {
              ...addr,
              latitude,
              longitude,
              accuracy: accuracy || null,
              address: displayAddress,
              formattedAddress: completeFormattedAddress
            }

            const currentLoc = location
            if (currentLoc && currentLoc.latitude && currentLoc.longitude) {
              const latDiff = latitude - currentLoc.latitude
              const lngDiff = longitude - currentLoc.longitude
              const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320

              const currentParts = (currentLoc.formattedAddress || "").split(',').filter(p => p.trim()).length
              const newParts = completeFormattedAddress.split(',').filter(p => p.trim()).length
              const addressImproved = newParts > currentParts

              if (distanceMeters <= 10 && !addressImproved) {
                return
              }
            }

            if (loc.formattedAddress && /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(loc.formattedAddress.trim())) {
              loc.formattedAddress = loc.area || loc.city || DEFAULT_LOCATION.formattedAddress;
              loc.address = loc.area || loc.city || DEFAULT_LOCATION.address;
            }

            const hasPlaceholder =
              loc.city === "Current Location" ||
              loc.address === "Select location" ||
              loc.formattedAddress === "Select location" ||
              (!loc.city && !loc.address && !loc.formattedAddress && !loc.area);

            const shouldPersistLocation = !hasPlaceholder
            if (hasPlaceholder) {
              const existingAddress =
                (location && typeof location === "object" ? location : null) ||
                (() => {
                  try {
                    const raw = localStorage.getItem("userLocation")
                    return raw ? JSON.parse(raw) : null
                  } catch {
                    return null
                  }
                })()

              loc = {
                ...loc,
                city: existingAddress?.city && existingAddress.city !== "Current Location" ? existingAddress.city : loc.city,
                area: existingAddress?.area || loc.area,
                state: existingAddress?.state || loc.state,
                address: existingAddress?.address && existingAddress.address !== "Select location" ? existingAddress.address : loc.address,
                formattedAddress: existingAddress?.formattedAddress && existingAddress.formattedAddress !== "Select location" ? existingAddress.formattedAddress : loc.formattedAddress,
              }
            }

            const coordThreshold = 0.0001
            const coordsChanged =
              !prevLocationCoordsRef.current.latitude ||
              !prevLocationCoordsRef.current.longitude ||
              Math.abs(prevLocationCoordsRef.current.latitude - loc.latitude) > coordThreshold ||
              Math.abs(prevLocationCoordsRef.current.longitude - loc.longitude) > coordThreshold
            
            let persistedLocation = loc
            try {
              const storedRaw = localStorage.getItem("userLocation")
              const storedLocation = storedRaw ? JSON.parse(storedRaw) : null
              const savedLabel = loc?.label || storedLocation?.label
              if (savedLabel && String(savedLabel).trim()) {
                persistedLocation = { ...loc, label: String(savedLabel).trim() }
              }
            } catch {
              persistedLocation = loc
            }

            if (coordsChanged) {
              prevLocationCoordsRef.current = { latitude: loc.latitude, longitude: loc.longitude }
              if (shouldPersistLocation) {
                localStorage.setItem("userLocation", JSON.stringify(persistedLocation))
              }
              setLocation(persistedLocation)
              setPermissionGranted(true)
              setError(null)
            } else if (shouldPersistLocation) {
              localStorage.setItem("userLocation", JSON.stringify(persistedLocation))
            }

            if (shouldPersistLocation) {
              clearTimeout(updateTimerRef.current)
              updateTimerRef.current = setTimeout(() => {
                updateLocationInDB(loc).catch(() => {})
              }, 5000)
            }
          } catch (err) {
            debugError("?? Error in watchPosition callback:", err)
          }
        },
        (err) => {
          debugWarn("?? watchPosition error:", err.code, err.message)
          if (err.code === 1) { // PERMISSION_DENIED
            setPermissionGranted(false)
            stopWatchingLocation()
          } else if (retryCount < maxRetries) {
            retryCount++
            stopWatchingLocation()
            setTimeout(() => startWatch({ enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }), 5000)
          }
        },
        options
      )
    }

    startWatch({ enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 })
  }

  const stopWatchingLocation = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      debugLog("?? Stopped watching location")
    }
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current)
    }
  }

  useEffect(() => {
    let hasInitialLocation = false
    let shouldForceRefresh = false
    let initialResolvedLocation = null
    const isAuthenticatedUser = () => {
      const token = localStorage.getItem("user_accessToken") || localStorage.getItem("accessToken")
      return Boolean(token && token !== "null" && token !== "undefined")
    }
    const hasUsableSavedLocation = (loc) => {
      if (!loc || typeof loc !== "object") return false
      const lat = Number(loc.latitude)
      const lng = Number(loc.longitude)
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
      const hasAddress =
        (loc.formattedAddress && loc.formattedAddress !== "Select location") ||
        (loc.address && loc.address !== "Select location") ||
        (loc.city && loc.city !== "Current Location")
      return hasCoords && Boolean(hasAddress)
    }

    const loadingTimeout = setTimeout(() => {
      setLoading(false)
    }, 5000)

    const init = async () => {
      try {
        const stored = localStorage.getItem("userLocation")
        if (stored) {
          try {
            const loc = JSON.parse(stored)
            if (loc?.latitude && loc?.longitude) {
              setLocation(loc)
              initialResolvedLocation = loc
              hasInitialLocation = true
              setLoading(false)
              setPermissionGranted(true)

              if (loc.city === "Current Location" || !loc.formattedAddress || loc.formattedAddress === "Select location") {
                shouldForceRefresh = true
              }
            }
          } catch (e) {
            debugWarn("Failed to parse stored location", e)
          }
        }

        const dbLoc = await fetchLocationFromDB()
        if (dbLoc) {
          setLocation(dbLoc)
          initialResolvedLocation = dbLoc
          hasInitialLocation = true
          setLoading(false)
          setPermissionGranted(true)
        }

        if (!hasInitialLocation) {
          setLocation(null)
          setLoading(false)
        }

        const currentKnownLocation = initialResolvedLocation || lastDbLocationRef.current || location
        const hasUsableInitialLocation = hasUsableSavedLocation(currentKnownLocation)
        const shouldPreserveSavedForLoggedIn =
          isAuthenticatedUser() && hasUsableInitialLocation

        const tryAutoResolveLocation = async () => {
          // Requirement:
          // - Guest/open app: auto-fetch current location
          // - Logged-in user with existing saved location: keep existing location
          if (!shouldPreserveSavedForLoggedIn) {
            const freshLoc = await getLocation(true, shouldForceRefresh)
            if (freshLoc) {
              setLocation(freshLoc)
              if (AUTO_START_LIVE_WATCH) startWatchingLocation()
            }
          } else if (AUTO_START_LIVE_WATCH && getDeliveryAddressMode() !== "saved") {
            startWatchingLocation()
          }
        }

        if (navigator.permissions && navigator.permissions.query) {
          const result = await navigator.permissions.query({ name: 'geolocation' })
          // `prompt` should also attempt geolocation so browser can ask permission.
          if (result.state === 'granted' || (!hasUsableInitialLocation && result.state === 'prompt')) {
            await tryAutoResolveLocation()
          }
        } else if (!hasUsableInitialLocation) {
          // Fallback for browsers/webviews that do not support Permissions API.
          await tryAutoResolveLocation()
        }
      } catch (err) {
        debugError("Initialization error", err)
      } finally {
        setLoading(false)
      }
    }

    init()

    return () => {
      clearTimeout(loadingTimeout)
      stopWatchingLocation()
    }
  }, [])

  useEffect(() => {
    const applyLocation = (locationData) => {
      if (!locationData?.latitude || !locationData?.longitude) return false

      setLocation(locationData)
      lastResolvedAddressRef.current = locationData
      prevLocationCoordsRef.current = {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
      }
      return true
    }

    const syncFromStorage = (event) => {
      if (applyLocation(event?.detail)) return

      const stored = readStoredUserLocation()
      applyLocation(stored)
    }

    const onModeChanged = () => {
      const mode = getDeliveryAddressMode()
      if (mode === "saved") {
        stopWatchingLocation()
        return
      }

      if (AUTO_START_LIVE_WATCH) {
        startWatchingLocation()
      }
    }

    window.addEventListener("userLocationChanged", syncFromStorage)
    window.addEventListener("deliveryAddressModeChanged", onModeChanged)
    return () => {
      window.removeEventListener("userLocationChanged", syncFromStorage)
      window.removeEventListener("deliveryAddressModeChanged", onModeChanged)
    }
  }, [])

  const requestLocation = async (options = {}) => {
    const live = options?.live === true
    setLoading(true)
    setError(null)
    try {
      if (live) {
        setDeliveryAddressMode("current")
        localStorage.removeItem("userLocation")
        lastResolvedAddressRef.current = null
        lastGeocodedCoordsRef.current = { latitude: null, longitude: null }
      }
      const loc = await getLocation(true, live, true)
      setPermissionGranted(true)
      if (loc) {
        persistUserLocation(loc)
      }
      if (AUTO_START_LIVE_WATCH && getDeliveryAddressMode() !== "saved") {
        startWatchingLocation()
      }
      return loc
    } catch (err) {
      setError(err.message || "Failed to get location")
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    location,
    loading,
    error,
    permissionGranted,
    requestLocation,
    startWatchingLocation,
    stopWatchingLocation,
  }
}
