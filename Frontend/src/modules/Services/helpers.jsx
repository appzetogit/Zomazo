/**
 * Field readers, booking-status wording and small UI bits for the Services
 * screens.
 */
import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Star } from "lucide-react"
import { API_BASE_URL } from "@food/api/config"

export const cx = (...a) => a.filter(Boolean).join(" ")

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"

export const formatMoney = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

const BACKEND_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL || "/api/v1", window.location.origin).origin
  } catch {
    return ""
  }
})()

/** Absolute URL for an image field that may be a bare /uploads path. */
export function mediaUrl(value) {
  const url = typeof value === "string" ? value : value?.url
  if (typeof url !== "string" || !url.trim()) return ""
  const t = url.trim()
  if (/^(https?:)?\/\//i.test(t) || /^(data|blob):/i.test(t)) return t
  return `${BACKEND_ORIGIN}${t.startsWith("/") ? "" : "/"}${t}`
}

/**
 * The SP realtime namespace lives on the platform's one Socket.IO server, at
 * <api origin>/sp. Connecting to the bare origin lands on the default
 * namespace and silently receives nothing.
 */
export const SP_SOCKET_URL = `${BACKEND_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "")}/sp`

/** GST-inclusive price of one unit, the way the server's price floor counts it. */
export const withGst = (price, gst) => Number(price || 0) * (1 + Number(gst ?? 18) / 100)

/** The customer is signed in on the platform (one login for every service). */
export const isSignedIn = () => {
  try {
    const token = localStorage.getItem("user_accessToken")
    if (!token) return false
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    // An expired access token still has a refresh token behind it; the API
    // client refreshes on the first call.
    return Boolean(payload) && (payload.exp * 1000 > Date.now() || Boolean(localStorage.getItem("user_refreshToken")))
  } catch {
    return false
  }
}

/**
 * Returns a function that sends a signed-out customer to the platform login and
 * back here afterwards. It returns true when the customer may carry on.
 */
export function useRequireLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(() => {
    if (isSignedIn()) return true
    navigate("/login", { state: { from: { pathname: location.pathname } } })
    return false
  }, [navigate, location.pathname])
}

/*
 * What each booking status means to the customer. The backend has more states
 * than a customer needs to tell apart (requested / searching, accepted /
 * assigned / confirmed), so several share wording and a step on the tracker.
 */
export const STATUS = {
  searching: { label: "Finding a professional", tone: "amber", step: 0 },
  requested: { label: "Finding a professional", tone: "amber", step: 0 },
  pending: { label: "Booking received", tone: "amber", step: 0 },
  awaiting_payment: { label: "Waiting for payment", tone: "amber", step: 1 },
  accepted: { label: "Professional assigned", tone: "blue", step: 1 },
  assigned: { label: "Professional assigned", tone: "blue", step: 1 },
  confirmed: { label: "Confirmed", tone: "blue", step: 1 },
  journey_started: { label: "Professional on the way", tone: "blue", step: 2 },
  visited: { label: "Professional arrived", tone: "blue", step: 3 },
  in_progress: { label: "Work in progress", tone: "blue", step: 3 },
  work_done: { label: "Work done", tone: "green", step: 4 },
  completed: { label: "Completed", tone: "green", step: 4 },
  no_vendors: { label: "No professional available", tone: "red", step: -1 },
  cancelled: { label: "Cancelled", tone: "red", step: -1 },
  rejected: { label: "Declined", tone: "red", step: -1 },
}

export const TRACK_STEPS = ["Booked", "Assigned", "On the way", "Working", "Done"]

export const statusOf = (s) => STATUS[String(s || "").toLowerCase()] || { label: s || "Unknown", tone: "gray", step: 0 }

export const TONE_CLASSES = {
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  gray: "bg-gray-100 text-gray-700 ring-gray-200",
}

export const ACTIVE_STATUSES = [
  "searching", "requested", "pending", "awaiting_payment", "accepted", "assigned",
  "confirmed", "journey_started", "visited", "in_progress", "work_done",
]

/** Statuses the customer may still move. Once someone is on the way, it is too late. */
export const canReschedule = (b) =>
  ["searching", "requested", "pending", "awaiting_payment", "accepted", "assigned", "confirmed"].includes(b?.status)
export const canCancel = (b) => !["completed", "cancelled", "rejected", "work_done"].includes(b?.status)
export const canReview = (b) => ["completed", "work_done"].includes(b?.status) && !b?.rating

export function StatusPill({ status, className }) {
  const s = statusOf(status)
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
        TONE_CLASSES[s.tone],
        className
      )}
    >
      {s.label}
    </span>
  )
}

export function Stars({ value = 0, size = 14, className }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0))
  return (
    <span className={cx("inline-flex items-center gap-0.5", className)} aria-label={`${v.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= Math.round(v) ? "fill-amber-400 text-amber-400" : "text-gray-300"}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

export function ImagePlaceholder({ name = "", className }) {
  const initial = String(name).trim().charAt(0).toUpperCase()
  return (
    <div
      role="img"
      aria-label={name ? `${name} (no photo yet)` : "No photo yet"}
      className={cx("flex h-full w-full items-center justify-center bg-violet-50 text-violet-400", className)}
    >
      <span className="text-lg font-extrabold">{initial || "S"}</span>
    </div>
  )
}

export function Thumb({ src, name, className }) {
  const url = mediaUrl(src)
  return (
    <div className={cx("overflow-hidden bg-gray-100", className)}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <ImagePlaceholder name={name} />
      )}
    </div>
  )
}

export function Skeleton({ className }) {
  return <div className={cx("animate-pulse rounded-xl bg-gray-200/70", className)} />
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <p className="text-base font-bold text-gray-900">{title}</p>
      {text ? <p className="mt-1 text-sm text-gray-500">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/* ─── Appointment slots ─────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, "0")
const label12 = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 || h === 24 ? "AM" : "PM"}`

/*
 * When visits can be booked. The server's rules (settings, served on
 * /public/config as bookingSlots) are what count: it refuses anything outside
 * them. These defaults match the server's and only stand in until the config
 * has loaded. Times are wall-clock in the business timezone, so a customer
 * whose phone is set elsewhere still sees the slots the professionals work.
 */
export const DEFAULT_SLOT_RULES = Object.freeze({
  startHour: 8,
  endHour: 20,
  slotHours: 2,
  leadMinutes: 60,
  advanceDays: 7,
  timezoneOffsetMinutes: 330,
})

const rulesOf = (rules) => ({ ...DEFAULT_SLOT_RULES, ...(rules || {}) })
const DAY_MS = 86400000

/** A Date whose UTC fields read as the business timezone's wall clock. */
const businessClock = (instant, rules) => new Date(instant + rulesOf(rules).timezoneOffsetMinutes * 60000)
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** Today and the days after it, as far ahead as bookings are taken. */
export function upcomingDays(rules) {
  const r = rulesOf(rules)
  const today = businessClock(Date.now(), r)
  const out = []
  for (let i = 0; i < r.advanceDays; i += 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i, 12))
    out.push({
      key: keyOf(d),
      weekday: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
      day: d.getUTCDate(),
      month: d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
    })
  }
  return out
}

/**
 * The slots for one day. One starting sooner than the notice a professional
 * needs is shown but disabled.
 */
export function slotsFor(dateKey, rules) {
  const r = rulesOf(rules)
  const [y, m, d] = dateKey.split("-").map(Number)
  const dayStart = Date.UTC(y, m - 1, d) - r.timezoneOffsetMinutes * 60000
  const earliest = Date.now() + r.leadMinutes * 60000
  const out = []
  for (let h = r.startHour; h + r.slotHours <= r.endHour; h += r.slotHours) {
    const start = `${pad(h)}:00`
    const end = `${pad(h + r.slotHours)}:00`
    out.push({
      id: `${dateKey}-${start}`,
      start,
      end,
      label: `${label12(h)} - ${label12(h + r.slotHours)}`,
      disabled: dayStart + h * 3600000 < earliest,
      // Noon of that day in the business timezone: the calendar day survives
      // the trip through UTC whichever side of midnight anyone is on.
      scheduledDate: new Date(dayStart + DAY_MS / 2).toISOString(),
    })
  }
  return out
}

/** The fields the booking and reschedule endpoints take for a picked slot. */
export function slotPayload(dateKey, slot) {
  const [y, m, d] = dateKey.split("-").map(Number)
  return {
    scheduledDate: slot.scheduledDate || new Date(Date.UTC(y, m - 1, d, 12) - DEFAULT_SLOT_RULES.timezoneOffsetMinutes * 60000).toISOString(),
    scheduledTime: slot.label,
    timeSlot: { start: slot.start, end: slot.end },
  }
}

export const formatDate = (value) => {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
}

export const formatDateTime = (value) => {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

export const addressText = (a) =>
  [a?.addressLine1, a?.addressLine2, a?.landmark, a?.city, a?.state, a?.pincode].filter(Boolean).join(", ")
