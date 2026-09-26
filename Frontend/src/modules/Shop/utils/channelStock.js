// Customer-side helpers for the Quick/Shop channel data (see CHANNELS_CONTRACT.md).
// A store mode ("quick" | "shop") is the channel. Old fields (stockQty,
// quickEligible) are read only as a fallback for responses not yet migrated.
import { cartStorageKeyFor } from "@store/context/StoreModeContext"

export const otherChannel = (channel) => (channel === "quick" ? "shop" : "quick")

export const CHANNEL_COPY = {
  quick: { label: "Quick", eta: "10 min" },
  shop: { label: "Shop", eta: "delivered in 2–4 days" },
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

// Is the product enabled for (and sold in) this channel?
export function productInChannel(product, channel) {
  if (!product) return false
  if (product.availableIn && typeof product.availableIn[channel] === "boolean") {
    return product.availableIn[channel]
  }
  if (product.channels && typeof product.channels[channel] === "boolean") {
    return product.channels[channel]
  }
  if (channel === "quick" && product.quickEligible === false) return false
  return product.isAvailable !== false
}

// null = not counted (always in stock).
export function productStock(product, channel) {
  if (!product) return null
  if (product.stockForChannel !== undefined) return num(product.stockForChannel)
  if (product.stock && typeof product.stock === "object") return num(product.stock[channel])
  return num(product.stockQty)
}

export function productLowThreshold(product, channel) {
  const t = product?.lowStockThreshold
  if (t && typeof t === "object") return num(t[channel])
  return num(t)
}

export function variantInChannel(variant, product, channel) {
  if (!variant) return false
  const own = variant.channels?.[channel]
  if (typeof own === "boolean") return own
  if (channel === "quick" && typeof variant.quickEligible === "boolean") return variant.quickEligible
  return product ? (product.channels?.[channel] ?? true) !== false : true
}

// Variant stock null = draws on the product's stock for the channel.
export function variantStock(variant, product, channel) {
  if (!variant) return productStock(product, channel)
  const s = variant.stock
  if (s && typeof s === "object") {
    const v = num(s[channel])
    if (v != null) return v
    return productStock(product, channel)
  }
  if (variant.stockQty != null) return num(variant.stockQty)
  return productStock(product, channel)
}

// { enabled, inStock, qty, low } for the product (or a variant) in a channel.
export function channelAvailability(product, channel, variant = null) {
  const enabled = productInChannel(product, channel) && (!variant || variantInChannel(variant, product, channel))
  const qty = variant ? variantStock(variant, product, channel) : productStock(product, channel)
  const inStock = enabled && (qty == null ? !variant || variant.inStock !== false : qty > 0)
  const threshold = productLowThreshold(product, channel) ?? 5
  const low = inStock && qty != null && qty <= threshold
  return { enabled, inStock, qty, low }
}

export function stockLabel({ enabled, inStock, qty, low }) {
  if (!enabled) return "Not available here"
  if (!inStock) return "Out of stock"
  if (low) return `Only ${qty} left`
  return "In stock"
}

// Adds a line to the other store's cart (stored per mode in localStorage).
// The other store's CartProvider reads it when that store is opened.
export function addToOtherStoreCart(item, targetChannel) {
  try {
    const key = cartStorageKeyFor(targetChannel)
    const raw = localStorage.getItem(key)
    const list = raw ? JSON.parse(raw) : []
    const arr = Array.isArray(list) ? list : []
    const match = arr.find((l) => String(l.id) === String(item.id) && String(l.variantId || "") === String(item.variantId || ""))
    if (match) match.quantity = (Number(match.quantity) || 0) + (Number(item.quantity) || 1)
    else arr.push({ ...item })
    localStorage.setItem(key, JSON.stringify(arr))
    return true
  } catch {
    return false
  }
}

// Pulls the offending product/variant id out of a checkout 400. The contract
// fixes the status, not the body, so accept the common shapes and fall back to
// matching an item name in the message.
export function findUnavailableCartItem(error, cart = []) {
  const data = error?.response?.data || {}
  if (error?.response?.status !== 400) return null
  const d = data.data || data.details || data.error || {}
  const ids = [data.productId, data.itemId, d.productId, d.itemId, d.item?.productId, d.items?.[0]?.productId, d.items?.[0]?.itemId]
    .filter(Boolean)
    .map(String)
  const variantId = String(data.variantId || d.variantId || d.items?.[0]?.variantId || "")
  let line = null
  if (ids.length) {
    line = cart.find((c) => ids.includes(String(c.productId || c.itemId || c.id)) && (!variantId || String(c.variantId || "") === variantId))
      || cart.find((c) => ids.includes(String(c.productId || c.itemId || c.id)))
  }
  const message = String(data.message || "")
  if (!line && /channel|not enabled|not available|quick|shop/i.test(message)) {
    line = cart.find((c) => c.name && message.toLowerCase().includes(String(c.name).toLowerCase())) || null
  }
  return line ? { item: line, message } : null
}
