/**
 * Field readers and small UI bits for the Quick screens.
 *
 * The look (cards, rails, stepper) comes from the Shop's Quick UI
 * (modules/Shop/components/user/desktop/quick); these readers point it at the
 * quick-commerce API's fields: a product is a store's "food" (packSize is the
 * unit, otherPrice / mrp the compare-at price, restaurantId its store).
 */
import { API_BASE_URL } from "@food/api/config"

export const cx = (...a) => a.filter(Boolean).join(" ")

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand"

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

const BACKEND_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL || "/api/v1", window.location.origin).origin
  } catch {
    return ""
  }
})()

/** Absolute URL for an image field that may be a bare /uploads path or {url}. */
export function mediaUrl(value) {
  const url = typeof value === "string" ? value : value?.url
  if (typeof url !== "string" || !url.trim()) return ""
  const t = url.trim()
  if (/^(https?:)?\/\//i.test(t) || /^(data|blob):/i.test(t)) return t
  return `${BACKEND_ORIGIN}${t.startsWith("/") ? "" : "/"}${t}`
}

export const productId = (p) => String(p?._id || p?.id || "")
export const productName = (p) => p?.name || "Product"
export const productPrice = (p) => num(p?.price) ?? num(p?.variants?.[0]?.price) ?? 0
export const productMrp = (p) => num(p?.mrp) ?? num(p?.otherPrice) ?? null
export const productImage = (p) => mediaUrl(p?.image || (Array.isArray(p?.images) ? p.images[0] : ""))
export const productPack = (p) => String(p?.packSize || "").trim()
/** Products with variants need a choice; the card sends those to their store. */
export const productHasOptions = (p) => Array.isArray(p?.variants) && p.variants.length > 0

/** The store a product comes from: search results carry `seller`, menus do not. */
export const productStore = (p, fallback) => ({
  id: String(p?.restaurantId?._id || p?.restaurantId || fallback?.id || ""),
  name: p?.seller?.name || p?.restaurantName || fallback?.name || "",
})

/** null = not counted (always in stock). */
export const productStock = (p) => {
  if (p?.isAvailable === false || p?.inStock === false) return 0
  return num(p?.stockQty)
}
export const productMaxQty = (p) => {
  const stock = productStock(p)
  const cap = num(p?.maxQtyPerOrder)
  if (stock == null) return cap
  return cap == null ? stock : Math.min(stock, cap)
}

export const percentOff = (price, mrp) => {
  const p = num(price)
  const m = num(mrp)
  if (p == null || m == null || m <= p || m <= 0) return null
  return Math.round(((m - p) / m) * 100)
}

export const formatMoney = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })

export const isRealImage = (src) => Boolean(src) && !String(src).startsWith("data:image/svg+xml")

export function ImagePlaceholder({ name = "", className }) {
  const initial = String(name).trim().charAt(0).toUpperCase()
  return (
    <div
      role="img"
      aria-label={name ? `${name} (no photo yet)` : "No photo yet"}
      className={cx("flex h-full w-full flex-col items-center justify-center gap-1 bg-[#F3F4F6] text-[#9CA3AF]", className)}
    >
      <svg viewBox="0 0 24 24" className="h-1/4 max-h-16 w-1/4 max-w-16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6 8h12l-1 12H7L6 8Z" strokeLinejoin="round" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      </svg>
      {initial ? <span className="text-[13px] font-bold">{initial}</span> : null}
    </div>
  )
}

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
