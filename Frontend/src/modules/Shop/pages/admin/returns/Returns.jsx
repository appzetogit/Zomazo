import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, PackageX, Search, Settings2, X } from "lucide-react"
import { adminAPI } from "@store/api"
import { formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"

const STATUSES = [
  ["", "All"],
  ["requested", "Requested"],
  ["approved", "Approved"],
  ["received", "Received (refund pending)"],
  ["refunded", "Refunded"],
  ["rejected", "Rejected"],
]

const STATUS_CLS = {
  requested: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  received: "bg-indigo-50 text-indigo-700",
  refunded: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
}

function StatusPill({ status }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_CLS[status] || "bg-slate-100 text-slate-700"}`}>{status}</span>
}

/** Shop panel: customer return requests: review, reverse pickup, receive and refund. */
export default function Returns() {
  const [status, setStatus] = useState("requested")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [windowDays, setWindowDays] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, limit: 20 }
    if (status) params.status = status
    if (query) params.search = query
    return adminAPI.getReturns(params)
      .then((res) => {
        const body = res?.data?.data || {}
        setRows(body.data || [])
        setMeta(body.meta || { total: 0, totalPages: 1 })
      })
      .catch((e) => { setRows([]); toast.error(errorMessage(e, "Failed to load returns")) })
      .finally(() => setLoading(false))
  }, [status, query, page])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    adminAPI.getReturnSettings().then((res) => setWindowDays(res?.data?.data?.returnWindowDays ?? 7)).catch(() => {})
  }, [])

  const saveWindow = async () => {
    const value = window.prompt("Return window in days after delivery (0-90):", String(windowDays ?? 7))
    if (value === null) return
    try {
      const res = await adminAPI.updateReturnSettings({ returnWindowDays: Number(value) })
      setWindowDays(res?.data?.data?.returnWindowDays)
      toast.success("Return window saved")
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the return window"))
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PackageX className="w-5 h-5 text-slate-600" />
        <h1 className="text-xl font-semibold text-slate-900">Returns</h1>
        <span className="text-sm text-slate-500">({meta.total || 0})</span>
        <button type="button" onClick={saveWindow} className="ml-auto text-sm px-3 py-1.5 border rounded-md inline-flex items-center gap-1">
          <Settings2 className="w-4 h-4" /> Return window: {windowDays ?? "…"} days
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map(([v, l]) => (
          <button key={v} type="button" onClick={() => { setPage(1); setStatus(v) }}
            className={`px-3 py-1.5 rounded-full border ${status === v ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 bg-white"}`}>{l}</button>
        ))}
        <form className="relative ml-auto" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()) }}>
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
          <input className="border border-slate-200 rounded-md pl-8 pr-2 py-2" placeholder="Order ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["Requested", "Order", "Seller", "Items", "Reason", "Refund", "Status"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No returns</td></tr>
            ) : rows.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedId(r._id)}>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                <td className="px-3 py-2 font-medium">#{r.orderReadableId}</td>
                <td className="px-3 py-2">{r.sellerName || "—"}</td>
                <td className="px-3 py-2">{(r.items || []).map((i) => `${i.quantity} × ${i.name}`).join(", ")}</td>
                <td className="px-3 py-2 max-w-[220px] truncate">{r.reason}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatCurrency(r.amounts?.refundAmount)}{r.refundTo === "coins" ? " (coins)" : ""}</td>
                <td className="px-3 py-2"><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded-md disabled:opacity-50">Prev</button>
        <span>Page {page} of {meta.totalPages || 1}</span>
        <button type="button" disabled={page >= (meta.totalPages || 1)} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded-md disabled:opacity-50">Next</button>
      </div>

      {selectedId && <ReturnDrawer id={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  )
}

function ReturnDrawer({ id, onClose, onChanged }) {
  const [ret, setRet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [bookPickup, setBookPickup] = useState(true)
  const [rejectReason, setRejectReason] = useState("")

  const load = useCallback(() => {
    adminAPI.getReturnById(id)
      .then((res) => setRet(res?.data?.data || null))
      .catch((e) => toast.error(errorMessage(e, "Failed to load the return")))
  }, [id])
  useEffect(() => { load() }, [load])

  const act = async (fn, success) => {
    setBusy(true)
    try {
      await fn()
      toast.success(success)
      load()
      onChanged?.()
    } catch (e) {
      toast.error(errorMessage(e, "Action failed"))
      load()
    } finally {
      setBusy(false)
    }
  }

  const o = ret?.order || {}
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Return · #{ret?.orderReadableId || ""}</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        {!ret ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <>
            <div className="flex items-center gap-2"><StatusPill status={ret.status} /><span className="text-xs text-slate-500">{formatDateTime(ret.createdAt)}</span></div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Seller</dt><dd>{ret.sellerName || "—"}</dd>
              <dt className="text-slate-500">Customer</dt><dd>{o.customerName} {o.customerPhone ? `· ${o.customerPhone}` : ""}</dd>
              <dt className="text-slate-500">Payment</dt><dd>{String(o.payment?.method || "").toUpperCase()} · {o.payment?.status}</dd>
              <dt className="text-slate-500">Order total</dt><dd>{formatCurrency(o.pricing?.total)}</dd>
              <dt className="text-slate-500">Items value</dt><dd>{formatCurrency(ret.amounts?.itemsValue)}</dd>
              <dt className="text-slate-500">Refund</dt><dd>{formatCurrency(ret.amounts?.refundAmount)} to {ret.refundTo === "coins" ? "coins" : "original method"}</dd>
              {ret.amounts?.coinsBack > 0 && (<><dt className="text-slate-500">Coins back</dt><dd>{ret.amounts.coinsBack}</dd></>)}
            </dl>

            <section className="text-sm">
              <h3 className="font-medium mb-1">Items</h3>
              <ul className="space-y-0.5">{(ret.items || []).map((i) => <li key={`${i.itemId}-${i.variantId}`}>{i.quantity} × {i.name} · {formatCurrency(i.price)}</li>)}</ul>
            </section>
            <section className="text-sm">
              <h3 className="font-medium mb-1">Reason</h3>
              <p>{ret.reason}</p>
              {ret.comment && <p className="text-slate-600 mt-1">{ret.comment}</p>}
              {ret.photos?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {ret.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt="" className="w-16 h-16 object-cover rounded-md border" /></a>)}
                </div>
              )}
            </section>

            {ret.reverseShipment && (
              <section className="text-sm">
                <h3 className="font-medium mb-1">Reverse pickup</h3>
                {ret.reverseShipment.error
                  ? <p className="text-red-600">Not booked: {ret.reverseShipment.error}</p>
                  : <p>{ret.reverseShipment.courierName} · AWB <span className="font-mono">{ret.reverseShipment.awb || "pending"}</span></p>}
              </section>
            )}
            {ret.rejectionReason && <p className="text-sm text-red-600">Rejected: {ret.rejectionReason}</p>}
            {ret.refund?.status === "failed" && <p className="text-sm text-red-600">Refund failed: {ret.refund.error}. You can retry.</p>}
            {ret.status === "refunded" && (
              <p className="text-sm text-green-700">Refunded {formatCurrency(ret.refund?.amount)} via {ret.refund?.method || "—"} on {formatDateTime(ret.refundedAt)}</p>
            )}

            {ret.status === "requested" && (
              <div className="space-y-3 border-t pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={bookPickup} onChange={(e) => setBookPickup(e.target.checked)} />
                  Book a reverse pickup with the courier
                </label>
                <button type="button" disabled={busy} onClick={() => act(() => adminAPI.approveReturn(id, { bookPickup }), "Return approved")} className="w-full py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-60">Approve</button>
              </div>
            )}
            {(ret.status === "approved" || (ret.status === "received" && ret.refund?.status === "failed")) && (
              <div className="border-t pt-3">
                <button type="button" disabled={busy}
                  onClick={() => window.confirm(`Mark the items received and refund ${formatCurrency(ret.amounts?.refundAmount)}?`) && act(() => adminAPI.receiveReturn(id), "Received and refunded")}
                  className="w-full py-2 rounded-md bg-green-600 text-white text-sm disabled:opacity-60">
                  {ret.status === "received" ? "Retry refund" : "Mark received & refund"}
                </button>
              </div>
            )}
            {(ret.status === "requested" || ret.status === "approved") && (
              <div className="space-y-2 border-t pt-3">
                <input className="w-full border border-slate-200 rounded-md px-2 py-2 text-sm" placeholder="Reason for rejecting" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <button type="button" disabled={busy || !rejectReason.trim()} onClick={() => act(() => adminAPI.rejectReturn(id, rejectReason.trim()), "Return rejected")} className="w-full py-2 rounded-md border border-red-300 text-red-600 text-sm disabled:opacity-60">Reject</button>
              </div>
            )}

            {ret.history?.length > 0 && (
              <section className="text-xs text-slate-500 border-t pt-3 space-y-1">
                {ret.history.map((h, i) => <div key={i}>{formatDateTime(h.at)} · <span className="capitalize">{h.status}</span> by {h.byRole}{h.note ? ` · ${h.note}` : ""}</div>)}
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
