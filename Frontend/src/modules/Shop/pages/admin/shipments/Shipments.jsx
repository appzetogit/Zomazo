import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ExternalLink, Loader2, RefreshCw, Search, Truck, X } from "lucide-react"
import { adminAPI } from "@store/api"
import { formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"
import ShipmentTabs from "./ShipmentTabs"

const STATUSES = [
  ["", "All"],
  ["not_booked", "Not booked"],
  ["booked", "Booked (active)"],
  ["manifested", "Manifested"],
  ["picked_up", "Picked up"],
  ["in_transit", "In transit"],
  ["out_for_delivery", "Out for delivery"],
  ["delivered", "Delivered"],
  ["undelivered", "Undelivered (NDR)"],
  ["rto_initiated", "RTO initiated"],
  ["rto_in_transit", "RTO in transit"],
  ["rto_delivered", "RTO delivered"],
  ["rto_received", "RTO received"],
  ["returned", "Returned (RTO, older)"],
  ["cancelled", "Cancelled"],
]

const STATUS_CLS = {
  not_booked: "bg-slate-100 text-slate-700",
  manifested: "bg-blue-50 text-blue-700",
  picked_up: "bg-indigo-50 text-indigo-700",
  in_transit: "bg-indigo-50 text-indigo-700",
  out_for_delivery: "bg-amber-50 text-amber-700",
  delivered: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-700",
  returned: "bg-red-50 text-red-700",
}

const label = (s) => String(s || "").replace(/_/g, " ")
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "—")

function StatusPill({ status }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_CLS[status] || "bg-slate-100 text-slate-700"}`}>{label(status)}</span>
}

/** Shop panel: courier shipments of standard orders, with tracking and admin book / cancel. */
export default function Shipments() {
  const [draft, setDraft] = useState({ status: "", courier: "", from: "", to: "", search: "" })
  const [filters, setFilters] = useState(draft)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, limit: 20 }
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
    return adminAPI.getShipments(params)
      .then((res) => {
        const body = res?.data?.data || {}
        setRows(body.data || [])
        setMeta(body.meta || { total: 0, totalPages: 1 })
      })
      .catch((e) => { setRows([]); toast.error(errorMessage(e, "Failed to load shipments")) })
      .finally(() => setLoading(false))
  }, [filters, page])

  useEffect(() => { load() }, [load])

  const book = async (row) => {
    setBusy(row._id)
    try {
      const res = await adminAPI.bookShipmentAdmin(row._id)
      toast.success(`Booked: AWB ${res?.data?.data?.shipment?.awb || ""}`)
      await load()
    } catch (e) {
      toast.error(errorMessage(e, "Could not book the shipment"))
    } finally {
      setBusy("")
    }
  }

  const cancel = async (row) => {
    const reason = window.prompt(`Cancel shipment AWB ${row.shipment?.awb}? Reason (optional):`, "")
    if (reason === null) return
    setBusy(row._id)
    try {
      await adminAPI.cancelShipmentAdmin(row._id, reason)
      toast.success("Shipment cancelled")
      setSelected(null)
      await load()
    } catch (e) {
      toast.error(errorMessage(e, "Could not cancel the shipment"))
    } finally {
      setBusy("")
    }
  }

  const apply = (e) => { e?.preventDefault(); setPage(1); setFilters(draft) }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Truck className="w-5 h-5 text-slate-600" />
        <h1 className="text-xl font-semibold text-slate-900">Courier Shipments</h1>
        <span className="text-sm text-slate-500">({meta.total || 0})</span>
      </div>
      <ShipmentTabs />

      <form onSubmit={apply} className="bg-white rounded-xl border border-slate-200 p-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
        <div className="col-span-2 relative">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
          <input className="w-full border border-slate-200 rounded-md pl-8 pr-2 py-2" placeholder="Order ID or AWB" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
        </div>
        <select className="border border-slate-200 rounded-md px-2 py-2" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="border border-slate-200 rounded-md px-2 py-2" placeholder="Courier" value={draft.courier} onChange={(e) => setDraft({ ...draft, courier: e.target.value })} />
        <input type="date" className="border border-slate-200 rounded-md px-2 py-2" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="From" />
        <input type="date" className="border border-slate-200 rounded-md px-2 py-2" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="To" />
        <div className="col-span-2 md:col-span-6 flex justify-end gap-2">
          <button type="button" className="px-3 py-1.5 rounded-md border border-slate-200" onClick={() => { const empty = { status: "", courier: "", from: "", to: "", search: "" }; setDraft(empty); setPage(1); setFilters(empty) }}>Reset</button>
          <button type="submit" className="px-3 py-1.5 rounded-md bg-slate-900 text-white">Apply</button>
        </div>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              {["Order", "Seller", "Customer", "Courier", "AWB", "Status", "ETD", "Label", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No shipments match these filters</td></tr>
            ) : rows.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(r)}>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">#{r.orderId}</div>
                  <div className="text-xs text-slate-500">{fmtDate(r.createdAt)} · <span className="capitalize">{label(r.orderStatus)}</span></div>
                </td>
                <td className="px-3 py-2">{r.seller?.name || "—"}</td>
                <td className="px-3 py-2">
                  <div>{r.customer?.name || "—"}</div>
                  <div className="text-xs text-slate-500">{r.destination?.city} {r.destination?.pincode}</div>
                </td>
                <td className="px-3 py-2">{r.shipment?.courierName || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.shipment?.awb || r.shipment?.cancelledAwb || "—"}</td>
                <td className="px-3 py-2"><StatusPill status={r.shipmentStatus} /></td>
                <td className="px-3 py-2">{fmtDate(r.shipment?.etd)}</td>
                <td className="px-3 py-2">
                  {r.shipment?.labelUrl && r.shipment?.awb ? (
                    <a href={r.shipment.labelUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 inline-flex items-center gap-1">Label <ExternalLink className="w-3 h-3" /></a>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {r.canBook && (
                    <button type="button" disabled={busy === r._id} onClick={() => book(r)} className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs disabled:opacity-60">Book</button>
                  )}
                  {r.canCancel && (
                    <button type="button" disabled={busy === r._id} onClick={() => cancel(r)} className="ml-2 px-2 py-1 rounded-md border border-red-300 text-red-600 text-xs disabled:opacity-60">Cancel</button>
                  )}
                </td>
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

      {selected && (
        <ShipmentDrawer
          row={selected}
          busy={busy === selected._id}
          onClose={() => setSelected(null)}
          onBook={() => book(selected).then(() => setSelected(null))}
          onCancel={() => cancel(selected)}
          onChanged={load}
        />
      )}
    </div>
  )
}

function ShipmentDrawer({ row, busy, onClose, onBook, onCancel, onChanged }) {
  const [tracking, setTracking] = useState(null)
  const [loading, setLoading] = useState(false)
  const s = row.shipment || {}

  const track = useCallback(async () => {
    if (!s.awb) return
    setLoading(true)
    try {
      const res = await adminAPI.trackShipmentAdmin(row._id)
      const data = res?.data?.data || null
      setTracking(data)
      if (data?.orderDelivered) {
        toast.success("Courier reports delivered: order marked delivered")
        onChanged?.()
      }
    } catch (e) {
      toast.error(errorMessage(e, "Could not fetch tracking"))
    } finally {
      setLoading(false)
    }
  }, [row._id, s.awb, onChanged])

  useEffect(() => { track() }, [track])

  const events = [...(tracking?.tracking?.trackingEvents || [])].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Order #{row.orderId}</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Seller</dt><dd>{row.seller?.name || "—"}</dd>
          <dt className="text-slate-500">Customer</dt><dd>{row.customer?.name} {row.customer?.phone ? `· ${row.customer.phone}` : ""}</dd>
          <dt className="text-slate-500">Destination</dt><dd>{row.destination?.city} {row.destination?.pincode}</dd>
          <dt className="text-slate-500">Order total</dt><dd>{formatCurrency(row.total)} · {String(row.paymentMethod).toUpperCase()}</dd>
          <dt className="text-slate-500">Order status</dt><dd className="capitalize">{label(tracking?.orderStatus || row.orderStatus)}</dd>
          <dt className="text-slate-500">Courier</dt><dd>{s.courierName || "—"}</dd>
          <dt className="text-slate-500">AWB</dt><dd className="font-mono text-xs">{s.awb || (s.cancelledAwb ? `${s.cancelledAwb} (cancelled)` : "—")}</dd>
          <dt className="text-slate-500">Shipment ID</dt><dd className="font-mono text-xs">{s.shipmentId || "—"}</dd>
          <dt className="text-slate-500">ETD</dt><dd>{fmtDate(s.etd)}</dd>
          <dt className="text-slate-500">Last tracked</dt><dd>{formatDateTime(s.lastTrackedAt)}</dd>
        </dl>

        <div className="flex gap-2">
          {row.canBook && <button type="button" disabled={busy} onClick={onBook} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm disabled:opacity-60">Book shipment</button>}
          {row.canCancel && <button type="button" disabled={busy} onClick={onCancel} className="px-3 py-1.5 rounded-md border border-red-300 text-red-600 text-sm disabled:opacity-60">Cancel shipment</button>}
          {s.labelUrl && s.awb && <a href={s.labelUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-md border text-sm inline-flex items-center gap-1">Label <ExternalLink className="w-3 h-3" /></a>}
        </div>

        {s.awb && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Live tracking</h3>
              <button type="button" onClick={track} disabled={loading} className="text-sm text-blue-600 inline-flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
            {tracking?.tracking?.currentStatus && <p className="text-sm mb-2">Current: <StatusPill status={tracking.tracking.currentStatus} /></p>}
            {loading && !tracking ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : events.length === 0 ? (
              <p className="text-sm text-slate-500">No tracking events yet</p>
            ) : (
              <ol className="border-l border-slate-200 ml-2 space-y-3">
                {events.map((ev, i) => (
                  <li key={i} className="pl-3 relative text-sm">
                    <span className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-slate-300" />
                    <div className="font-medium capitalize">{label(ev.status)}</div>
                    <div className="text-slate-600">{ev.activity}</div>
                    <div className="text-xs text-slate-400">{ev.location} {ev.timestamp ? `· ${formatDateTime(ev.timestamp)}` : ""}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </aside>
    </div>
  )
}
