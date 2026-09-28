/**
 * The live map on a Quick order: the store, the delivery address, the rider
 * and the road between the rider and their next stop.
 *
 * Positions come from the order page (the /qc socket's location-update, with
 * the order's own last known position behind it); the road is the
 * /qc/orders/:id/route polyline, re-cut from the rider's position by the
 * server. No map library of Quick's own: Google Maps is loaded the way Food's
 * tracking map loads it (same loader id, key and libraries), and when another
 * screen of the super app already loaded it, that copy is used as is.
 */
import { Component, useEffect, useMemo, useState } from "react"
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api"
import { getGoogleMapsApiKeySync } from "@food/utils/googleMapsApiKey"

// Food's DeliveryTrackingMap options, so the two screens share one loaded script.
const LOADER_ID = "google-map-script"
const LIBRARIES = ["geometry", "places"]

const MAP_STYLE = { width: "100%", height: "100%" }
const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: "cooperative",
}

const pin = (fill, glyph) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="${fill}" stroke="white" stroke-width="3"/><text x="20" y="25.5" font-family="Arial" font-size="15" font-weight="700" text-anchor="middle" fill="white">${glyph}</text></svg>`,
  )}`
const ICON_STORE = pin("#B45309", "S")
const ICON_HOME = pin("#15803D", "H")
const ICON_RIDER = pin("#EA580C", "R")

/** { lat, lng } from a GeoJSON point, a {lat,lng} / {latitude,longitude} pair, or null. */
export function toLatLng(v) {
  if (!v) return null
  const c = Array.isArray(v.coordinates) ? v.coordinates : null
  const lat = Number(c ? c[1] : v.lat ?? v.latitude)
  const lng = Number(c ? c[0] : v.lng ?? v.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

/** Google's encoded polyline format, decoded without the geometry library. */
function decodePolyline(encoded) {
  const points = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0
      let shift = 0
      let byte
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20 && index < encoded.length)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lng += delta
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

function MapCanvas({ store, home, rider, polyline }) {
  const [map, setMap] = useState(null)
  // Only the first centre: a moving rider must not keep re-centring the map.
  const [initialCenter] = useState(() => rider || home || store)
  const path = useMemo(() => {
    try {
      return polyline ? decodePolyline(polyline) : []
    } catch {
      return []
    }
  }, [polyline])

  // Frame everything that is known; re-framed when the rider first appears or
  // the leg changes, not on every ping (that would fight the customer's zoom).
  const frameKey = [store, home].map((p) => (p ? `${p.lat},${p.lng}` : "-")).join("|") + `|${Boolean(rider)}|${path.length > 1}`
  useEffect(() => {
    if (!map || !window.google?.maps) return
    const pts = [store, home, rider].filter(Boolean)
    if (!pts.length) return
    if (pts.length === 1) {
      map.setCenter(pts[0])
      map.setZoom(15)
      return
    }
    const bounds = new window.google.maps.LatLngBounds()
    pts.forEach((p) => bounds.extend(p))
    map.fitBounds(bounds, 48)
  }, [map, frameKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GoogleMap mapContainerStyle={MAP_STYLE} options={MAP_OPTIONS} center={initialCenter} zoom={14} onLoad={setMap} onUnmount={() => setMap(null)}>
      {store ? <MarkerF position={store} icon={ICON_STORE} title="Store" /> : null}
      {home ? <MarkerF position={home} icon={ICON_HOME} title="Delivery address" /> : null}
      {path.length > 1 ? <PolylineF path={path} options={{ strokeColor: "#B45309", strokeOpacity: 0.9, strokeWeight: 5 }} /> : null}
      {rider ? <MarkerF position={rider} icon={ICON_RIDER} title="Your delivery partner" zIndex={10} /> : null}
    </GoogleMap>
  )
}

function LoadThenRender(props) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: LOADER_ID,
    googleMapsApiKey: getGoogleMapsApiKeySync(),
    libraries: LIBRARIES,
  })
  if (loadError) return <MapFallback />
  if (!isLoaded) return <div className="h-full w-full animate-pulse bg-[#F0F2F2]" aria-hidden="true" />
  return <MapCanvas {...props} />
}

function MapFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#F7F7F7] px-6 text-center text-[13px] text-wh-muted">
      The live map is not available right now. Your order status below still updates live.
    </div>
  )
}

/**
 * The page never goes down with the map: a loader already started elsewhere
 * with different options throws, and so can a bad key.
 */
class MapBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? <MapFallback /> : this.props.children
  }
}

export default function TrackingMap({ store, home, rider, polyline, className = "h-[260px]" }) {
  const hasKey = Boolean(getGoogleMapsApiKeySync())
  // Decided once, so the map is not remounted when our own loader finishes.
  const [alreadyLoaded] = useState(() => typeof window !== "undefined" && Boolean(window.google?.maps?.Map))
  if (!store && !home && !rider) return null
  return (
    <div className={`${className} w-full overflow-hidden rounded-[10px] bg-[#F0F2F2]`}>
      <MapBoundary>
        {alreadyLoaded ? (
          <MapCanvas store={store} home={home} rider={rider} polyline={polyline} />
        ) : hasKey ? (
          <LoadThenRender store={store} home={home} rider={rider} polyline={polyline} />
        ) : (
          <MapFallback />
        )}
      </MapBoundary>
    </div>
  )
}
