import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { quickAPI } from "../api"

/**
 * Where the customer is, and which quick-commerce zone that falls in.
 *
 * Starts from the location the rest of the platform already saved
 * (localStorage "userLocation", written by the food app's useLocation), so a
 * customer arriving from Food is not asked again; otherwise asks the browser.
 * The zone decides which stores and products are shown -- quick commerce only
 * sells what can reach the customer in minutes.
 */
const QuickLocationContext = createContext(null)

const STORAGE_KEY = "userLocation"

const readSaved = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
    const lat = Number(raw?.latitude ?? raw?.lat)
    const lng = Number(raw?.longitude ?? raw?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
    return {
      latitude: lat,
      longitude: lng,
      label: raw?.area || raw?.city || raw?.formattedAddress || raw?.address || "",
    }
  } catch {
    return null
  }
}

export function QuickLocationProvider({ children }) {
  const [location, setLocation] = useState(readSaved)
  const [zone, setZone] = useState({ status: "loading", zoneId: null, zone: null })
  const [locating, setLocating] = useState(false)

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setZone({ status: "unknown", zoneId: null, zone: null })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, label: "Current location" }
        setLocation(next)
        setLocating(false)
      },
      () => {
        setLocating(false)
        setZone((z) => (z.zoneId ? z : { status: "unknown", zoneId: null, zone: null }))
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    )
  }, [])

  // No saved location yet: ask once.
  useEffect(() => {
    if (!location) requestLocation()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!location) return undefined
    let cancelled = false
    setZone((z) => ({ ...z, status: "loading" }))
    quickAPI
      .detectZone(location.latitude, location.longitude)
      .then((d) => {
        if (cancelled) return
        setZone(
          d?.status === "IN_SERVICE" && d.zoneId
            ? { status: "in", zoneId: String(d.zoneId), zone: d.zone }
            : { status: "out", zoneId: null, zone: null },
        )
      })
      .catch(() => !cancelled && setZone({ status: "unknown", zoneId: null, zone: null }))
    return () => {
      cancelled = true
    }
  }, [location])

  const value = useMemo(
    () => ({
      location,
      locating,
      requestLocation,
      zoneId: zone.zoneId,
      zoneName: zone.zone?.zoneName || zone.zone?.name || "",
      zoneStatus: zone.status, // loading | in | out | unknown
      areaLabel: location?.label || zone.zone?.zoneName || zone.zone?.name || "",
    }),
    [location, locating, requestLocation, zone],
  )

  return <QuickLocationContext.Provider value={value}>{children}</QuickLocationContext.Provider>
}

export const useQuickLocation = () => {
  const ctx = useContext(QuickLocationContext)
  if (!ctx) throw new Error("useQuickLocation must be used inside QuickLocationProvider")
  return ctx
}
