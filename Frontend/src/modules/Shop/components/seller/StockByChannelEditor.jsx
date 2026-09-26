import React, { useEffect, useMemo, useState } from "react"
import { Loader2, AlertTriangle, Save } from "lucide-react"
import { toast } from "sonner"
import { sellerAPI } from "@store/api"
import { CHANNELS, CHANNEL_INFO, productChannels, channelStock, toStockValue } from "./channels"

const variantEnabled = (item, v, channel) => {
  const own = v?.channels?.[channel]
  return own === true || own === false ? own : productChannels(item)[channel]
}

/**
 * Per-channel stock editor. Sends `{ itemId, channel, qty, variantId? }` rows to the
 * seller stock route and shows the channel's low-stock list.
 */
export default function StockByChannelEditor({ categories = [], onStockUpdated }) {
  const [channel, setChannel] = useState("quick")
  const [edits, setEdits] = useState({}) // key -> input string
  const [saving, setSaving] = useState(false)
  const [lowStock, setLowStock] = useState([])
  const [lowLoading, setLowLoading] = useState(false)

  const rows = useMemo(() => {
    const out = []
    categories.forEach((cat) =>
      (cat.items || []).forEach((item) => {
        if (!productChannels(item)[channel]) return
        const itemId = String(item.id || item._id)
        out.push({ key: itemId, itemId, name: item.name, current: channelStock(item, channel) })
        ;(item.variants || []).forEach((v) => {
          const variantId = String(v._id || v.id || "")
          if (!variantId || !variantEnabled(item, v, channel)) return
          out.push({
            key: `${itemId}:${variantId}`,
            itemId,
            variantId,
            name: `${item.name} — ${v.name || v.packSize || "Variant"}`,
            current: channelStock(v, channel),
            isVariant: true,
          })
        })
      }),
    )
    return out
  }, [categories, channel])

  useEffect(() => {
    let alive = true
    setLowLoading(true)
    sellerAPI
      .getLowStock(channel)
      .then((res) => {
        const d = res?.data?.data
        const list = Array.isArray(d) ? d : d?.items || d?.products || []
        if (alive) setLowStock(list.filter((r) => !r.channel || r.channel === channel))
      })
      .catch(() => alive && setLowStock([]))
      .finally(() => alive && setLowLoading(false))
    return () => {
      alive = false
    }
  }, [channel])

  useEffect(() => setEdits({}), [channel])

  const changed = rows.filter((r) => {
    if (edits[r.key] === undefined) return false
    const next = toStockValue(edits[r.key])
    return next !== null && next !== r.current
  })

  const save = async () => {
    if (!changed.length) return
    setSaving(true)
    try {
      await sellerAPI.updateStock(
        changed.map((r) => ({
          itemId: r.itemId,
          ...(r.variantId ? { variantId: r.variantId } : {}),
          channel,
          qty: toStockValue(edits[r.key]),
        })),
      )
      toast.success(`${CHANNEL_INFO[channel].label} stock updated for ${changed.length} row(s)`)
      setEdits({})
      onStockUpdated?.()
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to update stock")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
              channel === c ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"
            }`}
          >
            {CHANNEL_INFO[c].label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{CHANNEL_INFO[channel].blurb} Blank product stock means not counted; blank variant stock draws on the product's {CHANNEL_INFO[channel].label} stock.</p>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
        <p className="font-semibold text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Low stock in {CHANNEL_INFO[channel].label}
        </p>
        {lowLoading ? (
          <p className="text-amber-700 mt-1">Loading…</p>
        ) : lowStock.length === 0 ? (
          <p className="text-amber-700 mt-1">Nothing below its threshold.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-amber-900">
            {lowStock.slice(0, 20).map((r, i) => (
              <li key={`${r._id || r.productId || r.id}-${r.variantId || ""}-${i}`}>
                {r.name}
                {r.variantName ? ` — ${r.variantName}` : ""}: <strong>{r.qty ?? r.stock ?? "?"}</strong>
                {r.lowStockThreshold !== undefined && r.lowStockThreshold !== null ? ` (threshold ${r.lowStockThreshold})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-600 sticky top-0">
            <tr>
              <th className="p-2.5">Item</th>
              <th className="p-2.5 text-right">Current</th>
              <th className="p-2.5 text-right w-28">New {CHANNEL_INFO[channel].label} stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-slate-400">
                  No items are listed in {CHANNEL_INFO[channel].label}.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={`p-2.5 ${r.isVariant ? "pl-6 text-slate-500" : "font-medium text-slate-900"}`}>{r.name}</td>
                <td className="p-2.5 text-right">
                  {r.current === null ? (r.isVariant ? "Uses product" : "Not counted") : r.current}
                </td>
                <td className="p-2.5 text-right">
                  <input
                    type="number"
                    min="0"
                    value={edits[r.key] ?? ""}
                    placeholder={r.current === null ? "" : String(r.current)}
                    onChange={(e) => setEdits((p) => ({ ...p, [r.key]: e.target.value }))}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || changed.length === 0}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save {changed.length || ""} change{changed.length === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  )
}
