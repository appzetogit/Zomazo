import { useEffect, useState } from "react"
import { catalogAPI } from "@store/api"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"

export const DEFAULT_QUICK_ETA = 10

/** The Quick delivery time for the customer's zone (admin-set per zone), 10 when unknown. */
export function useQuickEta() {
  const { zone } = useDeliveryLocation()
  const n = Number(zone?.etaMinutes)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_QUICK_ETA
}

/** A 6-digit pincode from the delivery location (saved address or live location). */
export function locationPincode(location) {
  const direct = [
    location?.deliveryAddress?.zipCode,
    location?.deliveryAddress?.pincode,
    location?.postalCode,
    location?.zipCode,
    location?.pincode,
  ].map((v) => String(v || "").trim()).find((v) => /^\d{6}$/.test(v))
  if (direct) return direct
  const match = String(location?.formattedAddress || location?.address || "").match(/\b(\d{6})\b/)
  return match ? match[1] : ""
}

// One request per pincode for the session; every tile shares the answer.
const estimateCache = new Map() // pincode|"" -> estimate
const estimateInFlight = new Map()

function fetchEstimate(pincode) {
  if (estimateCache.has(pincode)) return Promise.resolve(estimateCache.get(pincode))
  if (estimateInFlight.has(pincode)) return estimateInFlight.get(pincode)
  const p = catalogAPI
    .getDeliveryEstimate({ fulfilmentMode: "standard", ...(pincode ? { pincode } : {}) })
    .then((res) => {
      const data = res?.data?.data || null
      if (data) estimateCache.set(pincode, data)
      return data
    })
    .catch(() => null)
    .finally(() => estimateInFlight.delete(pincode))
  estimateInFlight.set(pincode, p)
  return p
}

/**
 * Shop (courier) delivery window for the customer's pincode:
 * `{ minDays, maxDays, fromDate, toDate }` or null while loading/failed.
 */
export function useShopDeliveryEstimate({ enabled = true } = {}) {
  const { effectiveLocation } = useDeliveryLocation()
  const pincode = locationPincode(effectiveLocation)
  const [estimate, setEstimate] = useState(() => estimateCache.get(pincode) || null)
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const cached = estimateCache.get(pincode)
    if (cached) {
      setEstimate(cached)
      return undefined
    }
    fetchEstimate(pincode).then((data) => alive && setEstimate(data))
    return () => {
      alive = false
    }
  }, [pincode, enabled])
  return estimate
}

const parseYmd = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

const dayLabel = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })

/** "Delivery by Thu, 24 Sep" or "Delivery Wed, 23 Sep – Fri, 25 Sep"; fallback text when unknown. */
export function formatDeliveryWindow(estimate, fallback = "Delivered in 2–4 days") {
  const from = parseYmd(estimate?.fromDate)
  const to = parseYmd(estimate?.toDate)
  if (!to) return fallback
  if (!from || from.getTime() === to.getTime()) return `Delivery by ${dayLabel(to)}`
  return `Delivery ${dayLabel(from)} – ${dayLabel(to)}`
}
