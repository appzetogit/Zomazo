import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, RotateCcw, Search } from "lucide-react"
import { adminAPI } from "@store/api"
import { formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"
import ShipmentTabs from "./ShipmentTabs"

const STATES = [["open", "Returning"], ["received", "Received"], ["all", "All"]]
const label = (s) => String(s || "").replace(/_/g, " ")

/** Shop panel: shipments returning to the seller; receiving one restocks it and refunds a prepaid order. */
export default function RtoQueue() {
  const [state, setState] = useState("open")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, limit: 20, state }
    if (query) params.search = query
    return adminAPI.getRtoQueue(params)
      .then((res) => {
        const body = res?.data?.data || {}
        setRows(body.data || [])
        setMeta(body.meta || { total: 0, totalPages: 1 })
      })
      .catch((e) => { setRows([]); toast.error(errorMessage(e, "Failed to load the RTO queue")) })
      .finally(() => setLoading(false))
  }, [page, state, query])

  useEffect(() => { load() }, [load])

  const receive = async (row) => {
    const what = row.prepaid ? "restock the items and refund the customer" : "restock the items (COD: nothing to refund)"
    const note = window.prompt(`Mark #${row.orderId} received at the seller? This will ${what}. Note (optional):`, "")
    if (note === null) return
    setBusy(row._id)
    try {
      const res = await adminAPI.receiveRtoAdmin(row._id, { note })
      const d = res?.data?.data || {}
      const failed = d.refund?.status === "failed"
      const refund = d.refund?.status === "processed" ? `refunded ${formatCurrency(d.refund.amount)}` : failed ? "refund failed, retry" : "no refund"
      toast[failed ? "error" : "success"](`Received${d.restocked ? ", restocked" : ""}; ${refund}`)
      await load()
    } catch (e) {
      toast.error(errorMessage(e, "Could not mark received"))
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <RotateCcw className="w-5 h-5 text-slate-600" />
        <h1 className="text-xl font-semibold text-slate-900">RTO Queue</h1>
        <span className="text-sm text-slate-500">({meta.total || 0})</span>
      </div>
      <ShipmentTabs />

      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()) }} className="flex flex-wrap gap-2 text-sm">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
          <input className="border border-slate-200 rounded-md pl-8 pr-2 py-2" placeholder="Order ID or AWB" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="border border-slate-200 rounded-md px-2 py-2" value={state} onChange={(e) => { setPage(1); setState(e.target.value) }}>
          {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="submit" className="px-3 py-1.5 rounded-md bg-slate-900 text-white">Search</button>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["Order", "Seller", "AWB", "Status", "RTO since", "Payment", "Refund", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Nothing returning to origin</td></tr>
            ) : rows.map((r) => (
              <tr key={r._id}>
                <td className="px-3 py-2"><div className="font-medium">#{r.orderId}</div><div className="text-xs text-slate-500 capitalize">{label(r.orderStatus)}</div></td>
                <td className="px-3 py-2">{r.seller?.name || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.shipment?.awb || r.shipment?.cancelledAwb || "—"}</td>
                <td className="px-3 py-2 capitalize">{label(r.shipment?.status)}</td>
                <td className="px-3 py-2 text-xs">{formatDateTime(r.rto?.initiatedAt)}</td>
                <td className="px-3 py-2">{r.prepaid ? "Prepaid" : "COD"} · {formatCurrency(r.total)}</td>
                <td className="px-3 py-2 text-xs capitalize">{r.rto?.refund?.status ? label(r.rto.refund.status) : r.prepaid ? "pending" : "n/a"}</td>
                <td className="px-3 py-2 text-right">
                  {(!r.rto?.receivedAt || (r.prepaid && r.rto?.refund?.status === "failed")) && (
                    <button type="button" disabled={busy === r._id} onClick={() => receive(r)} className="px-2 py-1 rounded-md bg-slate-900 text-white text-xs disabled:opacity-60">
                      {r.rto?.receivedAt ? "Retry refund" : "Mark received"}
                    </button>
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
    </div>
  )
}
