import React from "react"
import { CHANNELS, CHANNEL_INFO, CHANNEL_STATUS_LABEL, channelStatus, toStockValue } from "./channels"

const inputCls =
  "w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums disabled:bg-gray-100 disabled:text-gray-400"

/** Draft (form strings) helpers for product / variant channel fields. */
export const emptyChannelDraft = () => ({ quick: "", shop: "" })
export const channelDraftFrom = (obj) => ({
  quick: obj?.quick === null || obj?.quick === undefined ? "" : String(obj.quick),
  shop: obj?.shop === null || obj?.shop === undefined ? "" : String(obj.shop),
})
export const channelDraftToPayload = (draft) => ({
  quick: toStockValue(draft?.quick),
  shop: toStockValue(draft?.shop),
})
/** Variant channel override: null = inherit. */
export const variantChannelsFrom = (v) => ({
  quick: v?.channels?.quick === true || v?.channels?.quick === false ? v.channels.quick : null,
  shop: v?.channels?.shop === true || v?.channels?.shop === false ? v.channels.shop : null,
})

/**
 * Product-level channel toggles + per-channel stock / low-stock threshold.
 * Channels the seller is not approved for are disabled (unless already on, so it can be switched off).
 */
export function ProductChannelFields({ seller, channels, onChannels, stock, onStock, threshold, onThreshold }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Sales channels & stock</p>
        <p className="text-[11px] text-gray-500">
          Leave stock empty to not count it (always in stock). Each channel keeps its own count.
        </p>
      </div>
      {CHANNELS.map((c) => {
        const approved = channelStatus(seller, c) === "approved"
        const on = channels[c] === true
        const disabled = !approved && !on
        return (
          <div key={c} className={`rounded-lg border p-2.5 ${on ? "border-blue-200 bg-blue-50/40" : "border-gray-200"}`}>
            <label className={`flex items-start gap-2 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={on}
                disabled={disabled}
                onChange={(e) => onChannels({ ...channels, [c]: e.target.checked })}
              />
              <span>
                <span className="text-sm font-semibold text-gray-900">{CHANNEL_INFO[c].label}</span>
                <span className="block text-[11px] text-gray-500">{CHANNEL_INFO[c].blurb}</span>
                {!approved && (
                  <span className="block text-[11px] text-amber-700">
                    You are not approved for {CHANNEL_INFO[c].label} ({CHANNEL_STATUS_LABEL[channelStatus(seller, c)]}).
                    Apply from Sales channels on your profile.
                  </span>
                )}
              </span>
            </label>
            {on && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">{CHANNEL_INFO[c].label} stock</label>
                  <input type="number" min="0" className={inputCls} value={stock[c]} placeholder="Not counted"
                    onChange={(e) => onStock({ ...stock, [c]: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Low-stock alert at</label>
                  <input type="number" min="0" className={inputCls} value={threshold[c]} placeholder="None"
                    onChange={(e) => onThreshold({ ...threshold, [c]: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Variant-level: channel override (inherit/on/off) + per-channel stock and threshold. */
export function VariantChannelFields({ productChannels, variant, onChange }) {
  const ch = variant.channels || { quick: null, shop: null }
  const stock = variant.channelStock || emptyChannelDraft()
  const threshold = variant.channelThreshold || emptyChannelDraft()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
      {CHANNELS.map((c) => {
        const effective = ch[c] === null ? productChannels[c] : ch[c]
        const value = ch[c] === null ? "inherit" : ch[c] ? "on" : "off"
        return (
          <div key={c} className="rounded-lg border border-gray-200 bg-white p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-gray-700">{CHANNEL_INFO[c].label}</span>
              <select
                className="text-[11px] border border-gray-300 rounded px-1 py-0.5"
                value={value}
                onChange={(e) => {
                  const v = e.target.value
                  onChange("channels", { ...ch, [c]: v === "inherit" ? null : v === "on" })
                }}
              >
                <option value="inherit">Same as product ({productChannels[c] ? "on" : "off"})</option>
                <option value="on" disabled={!productChannels[c]}>On</option>
                <option value="off">Off</option>
              </select>
            </div>
            {effective && (
              <div className="grid grid-cols-2 gap-1.5">
                <input type="number" min="0" className={inputCls} value={stock[c]} placeholder="Uses product"
                  title="Empty = draws on the product's stock for this channel"
                  onChange={(e) => onChange("channelStock", { ...stock, [c]: e.target.value })} />
                <input type="number" min="0" className={inputCls} value={threshold[c]} placeholder="Alert at"
                  onChange={(e) => onChange("channelThreshold", { ...threshold, [c]: e.target.value })} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
