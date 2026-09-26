/**
 * Shared field readers for the Quick desktop UI (QUICK_UI_SPEC.md).
 * Products come straight from searchAPI / catalogAPI, so every getter has to
 * cope with the two shapes the catalogue returns (flat product and variant-led).
 */
import { mediaUrl } from "../desktopCart"

export const cx = (...a) => a.filter(Boolean).join(" ")

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand"

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

export const productId = (p) => String(p?._id || p?.id || "")

export const productName = (p) => p?.name || p?.title || "Product"

export const productPrice = (p) => num(p?.displayPrice) ?? num(p?.price) ?? num(p?.variants?.[0]?.price) ?? 0

export const productMrp = (p) =>
  num(p?.mrp) ?? num(p?.originalPrice) ?? num(p?.otherPrice) ?? num(p?.variants?.[0]?.mrp) ?? null

export const productImage = (p) =>
  mediaUrl(p?.imageUrl || p?.image || (Array.isArray(p?.images) ? p.images[0] : ""))

/** Pack size / unit line under the name; blank when the catalogue has none. */
export const productPack = (p) => {
  const raw = p?.packSize || p?.unit || p?.unitLabel || p?.weight || p?.quantityLabel || ""
  return String(raw || "").trim()
}

/** Variants mean the customer has to choose, so the card links out to the product page. */
export const productHasOptions = (p) => Array.isArray(p?.variants) && p.variants.length > 0

export const formatMoney = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })
