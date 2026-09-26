import { useCallback, useEffect, useState } from "react"
import { Loader2, PackageX, X, ImagePlus } from "lucide-react"
import { toast } from "sonner"
import { userAPI, uploadAPI } from "@store/api"

const REASONS = [
  "Wrong item received",
  "Item damaged or defective",
  "Size or fit issue",
  "Not as described",
  "Changed my mind",
  "Other",
]

const STATUS_LABEL = {
  requested: { text: "Return requested", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { text: "Return approved", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  rejected: { text: "Return rejected", cls: "bg-red-50 text-red-700 border-red-200" },
  received: { text: "Items received", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  refunded: { text: "Refunded", cls: "bg-green-50 text-green-700 border-green-200" },
}

const money = (n) => `₹${(Number(n) || 0).toFixed(2)}`
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "")

/**
 * Returns for a delivered courier (standard) order: past requests with their
 * status, and a "Return items" button opening the request form.
 */
export default function OrderReturnsSection({ order }) {
  const orderId = order?._id || order?.id
  const status = String(order?.orderStatus || order?.status || "").toLowerCase()
  const isStandard = String(order?.fulfilmentMode || "").toLowerCase() === "standard"
  const [info, setInfo] = useState(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    if (!orderId) return
    userAPI.getOrderReturns(orderId)
      .then((res) => setInfo(res?.data?.data || null))
      .catch(() => setInfo(null))
  }, [orderId])

  useEffect(() => {
    if (isStandard && status === "delivered") load()
  }, [isStandard, status, load])

  if (!isStandard || status !== "delivered" || !info) return null
  const returns = info.returns || []
  if (!info.eligible && returns.length === 0) {
    return (
      <div className="px-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">{info.reason}</p>
      </div>
    )
  }

  return (
    <div className="px-4 space-y-3">
      {returns.map((r) => {
        const s = STATUS_LABEL[r.status] || { text: r.status, cls: "bg-gray-50 text-gray-700 border-gray-200" }
        return (
          <div key={r._id} className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 text-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-semibold text-gray-800 dark:text-white">Return · {fmtDate(r.createdAt)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${s.cls}`}>{s.text}</span>
            </div>
            <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
              {(r.items || []).map((i) => (
                <li key={`${i.itemId}-${i.variantId}`}>{i.quantity} × {i.name}</li>
              ))}
            </ul>
            <p className="text-xs text-gray-500 mt-2">Reason: {r.reason}</p>
            {r.status === "rejected" && r.rejectionReason && (
              <p className="text-xs text-red-600 mt-1">Not accepted: {r.rejectionReason}</p>
            )}
            {r.reverseShipment?.awb && (
              <p className="text-xs text-gray-500 mt-1">Pickup: {r.reverseShipment.courierName} · AWB {r.reverseShipment.awb}</p>
            )}
            <p className="text-xs text-gray-700 dark:text-gray-200 mt-1">
              {r.status === "refunded"
                ? `Refunded ${money(r.refund?.amount)}${r.refund?.method === "coins" ? " as coins" : ""}`
                : `Refund on receipt: ${money(r.amounts?.refundAmount)}${r.refundTo === "coins" ? " as coins" : ""}`}
              {r.amounts?.coinsBack > 0 ? ` + ${r.amounts.coinsBack} coins back` : ""}
            </p>
          </div>
        )
      })}

      {info.eligible ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full bg-white dark:bg-zinc-900 border border-wh-brand text-wh-brand-ink py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-orange-50 dark:hover:bg-orange-900/20"
        >
          <PackageX className="w-4 h-4" />
          Return items
        </button>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">{info.reason}</p>
      )}
      {info.eligible && info.windowEndsAt && (
        <p className="text-[11px] text-gray-500 text-center">Returns accepted until {fmtDate(info.windowEndsAt)}</p>
      )}

      {open && (
        <ReturnRequestModal
          orderId={orderId}
          info={info}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load() }}
        />
      )}
    </div>
  )
}

function ReturnRequestModal({ orderId, info, onClose, onDone }) {
  const lines = (info.items || []).filter((l) => l.returnable > 0)
  const [qty, setQty] = useState({})
  const [reason, setReason] = useState(REASONS[0])
  const [comment, setComment] = useState("")
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [refundTo, setRefundTo] = useState("original")
  const [submitting, setSubmitting] = useState(false)
  const key = (l) => `${l.itemId}::${l.variantId || ""}`

  const addPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || photos.length >= 5) return
    setUploading(true)
    try {
      const res = await uploadAPI.uploadMedia(file, { folder: "returns" })
      const url = res?.data?.data?.url
      if (url) setPhotos((p) => [...p, url])
    } catch (err) {
      toast.error(err?.response?.data?.message || "Photo upload failed")
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    const items = lines
      .map((l) => ({ itemId: l.itemId, variantId: l.variantId || "", quantity: Number(qty[key(l)]) || 0 }))
      .filter((i) => i.quantity > 0)
    if (!items.length) return toast.error("Pick at least one item to return")
    setSubmitting(true)
    try {
      await userAPI.requestOrderReturn(orderId, { items, reason, comment, photos, refundTo })
      toast.success("Return requested")
      onDone()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not request the return")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-zinc-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-white">Return items</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="space-y-2">
          {lines.map((l) => (
            <div key={key(l)} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate text-gray-800 dark:text-gray-100">{l.name}{l.variantName ? ` (${l.variantName})` : ""}</p>
                <p className="text-xs text-gray-500">{money(l.price)} · up to {l.returnable}</p>
              </div>
              <select
                className="border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 rounded-md px-2 py-1 text-sm"
                value={qty[key(l)] || 0}
                onChange={(e) => setQty((q) => ({ ...q, [key(l)]: Number(e.target.value) }))}
              >
                {Array.from({ length: l.returnable + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          ))}
        </div>

        <label className="block text-sm">
          <span className="text-gray-700 dark:text-gray-200">Reason</span>
          <select className="mt-1 w-full border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 rounded-md px-2 py-2" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700 dark:text-gray-200">Details (optional)</span>
          <textarea className="mt-1 w-full border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 rounded-md px-2 py-2" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>

        <div>
          <span className="text-sm text-gray-700 dark:text-gray-200">Photos (optional, up to 5)</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {photos.map((p) => (
              <div key={p} className="relative">
                <img src={p} alt="" className="w-14 h-14 rounded-md object-cover" />
                <button type="button" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))} className="absolute -top-1 -right-1 bg-white rounded-full shadow" aria-label="Remove photo">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {photos.length < 5 && (
              <label className="w-14 h-14 rounded-md border border-dashed border-gray-300 flex items-center justify-center cursor-pointer">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4 text-gray-500" />}
                <input type="file" accept="image/*" className="hidden" onChange={addPhoto} disabled={uploading} />
              </label>
            )}
          </div>
        </div>

        <fieldset className="text-sm space-y-1">
          <legend className="text-gray-700 dark:text-gray-200 mb-1">Refund to</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="refundTo" checked={refundTo === "original"} onChange={() => setRefundTo("original")} />
            {String(info.paymentMethod) === "cash" ? "Wallet (cash orders)" : "Original payment method"}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="refundTo" checked={refundTo === "coins"} onChange={() => setRefundTo("coins")} />
            Coins
          </label>
        </fieldset>

        <button
          type="button"
          onClick={submit}
          disabled={submitting || uploading}
          className="w-full bg-wh-brand text-wh-text py-3 rounded-lg font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Request return
        </button>
      </div>
    </div>
  )
}
