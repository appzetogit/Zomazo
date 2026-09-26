import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Loader2, Search } from "lucide-react"
import { adminAPI } from "@store/api"
import { formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"
import ShipmentTabs from "./ShipmentTabs"

const STATES = [["pending", "Needs action"], ["actioned", "Actioned"], ["all", "All"]]
const label = (s) => String(s || "").replace(/_/g, " ")

/** Shop panel: shipments with a failed delivery attempt, and what to do next. */
export default function NdrQueue() {
  const [state, setState] = useState("pending")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [reattempt, setReattempt] = useState(null)
  const [busy, setBusy] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, limit: 20, state }
    if (query) params.search = query
    return adminAPI.getNdrQueue(params)
      .then((res) => {
        const body = res?.data?.data || {}
        setRows(body.data || [])
        setMeta(body.meta || { total: 0, totalPages: 1 })
      })
      .catch((e) => { setRows([]); toast.error(errorMessage(e, "Failed to load the NDR queue")) })
      .finally(() => setLoading(false))
  }, [page, state, query])

  useEffect(() => { load() }, [load])

  const act = async (row, body, done) => {
    setBusy(row._id)
    try {
      await adminAPI.ndrActionAdmin(row._id, body)
      toast.success(done)
      setReattempt(null)
      await load()
    } catch (e) {
      toast.error(errorMessage(e, "Action failed"))
    } finally {
      setBusy("")
    }
  }

  const toRto = (row) => {
    if (!window.confirm(`Return order #${row.orderId} to the seller (RTO)?`)) return
    act(row, { action: "rto" }, "RTO requested")
  }
  const contact = (row) => {
    const message = window.prompt("Message to the customer (leave blank for the default):", "")
    if (message === null) return
    act(row, { action: "contact", message }, "Customer notified")
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        <h1 className="text-xl font-semibold text-slate-900">NDR Queue</h1>
        <span className="text-sm text-slate-500">({meta.total || 0})</span>
      </div>
      <ShipmentTabs />

      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()) }} className="flex flex-wrap gap-2 text-sm">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
          <input className="border border-slate-200 rounded-md pl-8 pr-2 py-2" placeholder="Order ID, AWB or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="border border-slate-200 rounded-md px-2 py-2" value={state} onChange={(e) => { setPage(1); setState(e.target.value) }}>
          {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="submit" className="px-3 py-1.5 rounded-md bg-slate-900 text-white">Search</button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["Order", "Customer", "AWB", "Attempts", "Reason", "Last attempt", "Action taken", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No failed delivery attempts here</td></tr>
            ) : rows.map((r) => (
              <tr key={r._id}>
                <td className="px-3 py-2">
                  <div className="font-medium">#{r.orderId}</div>
                  <div className="text-xs text-slate-500">{r.paymentMethod === "cash" ? "COD" : "Prepaid"} · {formatCurrency(r.total)}</div>
                </td>
                <td className="px-3 py-2">
                  <div>{r.customer?.name || "—"}</div>
                  <div className="text-xs text-slate-500">{r.customer?.phone} · {r.destination?.city} {r.destination?.pincode}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.shipment?.awb || "—"}<div className="text-slate-500 font-sans">{r.shipment?.courierName}</div></td>
                <td className="px-3 py-2">{r.ndr?.attempts || 0}</td>
                <td className="px-3 py-2 max-w-xs">{r.ndr?.lastReason || "—"}</td>
                <td className="px-3 py-2 text-xs">{formatDateTime(r.ndr?.lastAt)}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="capitalize">{r.ndr?.action ? `${label(r.ndr.action)} · ${formatDateTime(r.ndr.actionAt)}` : "—"}</span>
                  {r.ndr?.lastContactAt && <div className="text-slate-500">Contacted {formatDateTime(r.ndr.lastContactAt)}</div>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                  {!String(r.shipment?.status || "").startsWith("rto_") && (
                    <>
                      <button type="button" disabled={busy === r._id} onClick={() => setReattempt({ row: r, address1: "", address2: "", phone: "", deferredDate: "", comments: "" })} className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs disabled:opacity-60">Re-attempt</button>
                      <button type="button" disabled={busy === r._id} onClick={() => toRto(r)} className="px-2 py-1 rounded-md border border-red-300 text-red-600 text-xs disabled:opacity-60">RTO</button>
                      <button type="button" disabled={busy === r._id} onClick={() => contact(r)} className="px-2 py-1 rounded-md border border-slate-300 text-xs disabled:opacity-60">Contact</button>
                    </>
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

      {reattempt && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReattempt(null)}>
          <form
            className="bg-white rounded-xl p-4 w-full max-w-md space-y-2 text-sm"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const { row, ...fields } = reattempt
              const body = { action: "reattempt" }
              for (const [k, v] of Object.entries(fields)) if (String(v).trim()) body[k] = String(v).trim()
              act(row, body, "Re-attempt requested")
            }}
          >
            <h2 className="font-semibold">Re-attempt #{reattempt.row.orderId}</h2>
            <p className="text-xs text-slate-500">All fields optional; leave blank to re-attempt at the same address.</p>
            {[["address1", "Address line 1"], ["address2", "Address line 2"], ["phone", "Phone"], ["comments", "Comments"]].map(([k, l]) => (
              <input key={k} className="w-full border border-slate-200 rounded-md px-2 py-2" placeholder={l} value={reattempt[k]} onChange={(e) => setReattempt({ ...reattempt, [k]: e.target.value })} />
            ))}
            <label className="block text-xs text-slate-500">Deliver on
              <input type="date" className="w-full border border-slate-200 rounded-md px-2 py-2 text-sm text-slate-900" value={reattempt.deferredDate} onChange={(e) => setReattempt({ ...reattempt, deferredDate: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-1.5 rounded-md border" onClick={() => setReattempt(null)}>Close</button>
              <button type="submit" disabled={busy === reattempt.row._id} className="px-3 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-60">Request re-attempt</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
