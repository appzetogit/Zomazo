import React from "react"

/** Seller-side helpers for the Quick / Shop channels (see CHANNELS_CONTRACT.md). */
export const CHANNELS = ["quick", "shop"]

export const CHANNEL_INFO = {
  quick: {
    label: "Quick",
    blurb: "Delivered by riders in minutes from your store inside a service zone.",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
  },
  shop: {
    label: "Shop",
    blurb: "Shipped by courier to customers anywhere, from your pickup address.",
    badge: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
}

export const CHANNEL_STATUS_LABEL = {
  none: "Not applied",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
}

/** Seller's channel status, defaulting to 'none'. */
export const channelStatus = (seller, channel) =>
  seller?.channels?.[channel]?.status || "none"

export const isChannelApproved = (seller, channel) =>
  channelStatus(seller, channel) === "approved"

/** Product channel flags, defaulting to true per the contract. */
export const productChannels = (p) => ({
  quick: p?.channels?.quick !== false,
  shop: p?.channels?.shop !== false,
})

const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

export const channelStock = (entity, channel) => numOrNull(entity?.stock?.[channel])
export const channelThreshold = (entity, channel) => numOrNull(entity?.lowStockThreshold?.[channel])

/** Form input value -> contract number|null (empty = null = not counted / inherit product stock). */
export const toStockValue = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const formatStock = (n) => (n === null || n === undefined ? "Not counted" : String(n))

export function ChannelBadges({ product, showStock = false, className = "" }) {
  const ch = productChannels(product)
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {CHANNELS.filter((c) => ch[c]).map((c) => {
        const s = channelStock(product, c)
        return (
          <span
            key={c}
            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${CHANNEL_INFO[c].badge}`}
          >
            {CHANNEL_INFO[c].label}
            {showStock ? `: ${s === null ? "∞" : s}` : ""}
          </span>
        )
      })}
    </span>
  )
}
