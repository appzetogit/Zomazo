import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Layers, Loader2, Search } from "lucide-react"
import { adminAPI } from "@store/api"
import { useAdminBase, useAdminPanel } from "@store/components/admin/useAdminPanel"
import { formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"

const STATUSES = ["", "pending", "confirmed", "processing", "completed", "cancelled", "partial_cancelled"]
const label = (s) => String(s || "").replace(/_/g, " ")
const EMPTY = { search: "", status: "", from: "", to: "" }

/** Checkouts (order groups): one customer payment split into one order per seller. */
export default function Checkouts() {
  const base = useAdminBase()
  const { panel } = useAdminPanel()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(EMPTY)
  const [filters, setFilters] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, limit: 20, mode: panel }
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
    return adminAPI.getCheckoutsAdmin(params)
      .then((res) => {
        const body = res?.data?.data || {}
        setRows(body.data || [])
        setMeta(body.meta || { total: 0, totalPages: 1 })
      })
      .catch((e) => { setRows([]); toast.error(errorMessage(e, "Failed to load checkouts")) })
      .finally(() => setLoading(false))
  }, [filters, page, panel])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-slate-600" />
        <h1 className="text-xl font-semibold text-slate-900">Checkouts</h1>
        <span className="text-sm text-slate-500">({meta.total || 0})</span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setFilters(draft) }} className="bg-white rounded-xl border border-slate-200 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <div className="col-span-2 relative">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
          <input className="w-full border border-slate-200 rounded-md pl-8 pr-2 py-2" placeholder="Checkout ID, order ID, customer or phone" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
        </div>
        <select className="border border-slate-200 rounded-md px-2 py-2 capitalize" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? label(s) : "Any status"}</option>)}
        </select>
        <input type="date" aria-label="From" className="border border-slate-200 rounded-md px-2 py-2" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        <input type="date" aria-label="To" className="border border-slate-200 rounded-md px-2 py-2" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        <div className="col-span-2 md:col-span-5 flex justify-end gap-2">
          <button type="button" className="px-3 py-1.5 rounded-md border border-slate-200" onClick={() => { setDraft(EMPTY); setPage(1); setFilters(EMPTY) }}>Reset</button>
          <button type="submit" className="px-3 py-1.5 rounded-md bg-slate-900 text-white">Apply</button>
        </div>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["Checkout", "Customer", "Orders", "Total", "Payment", "Coupon / coins", "Status"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No checkouts match these filters</td></tr>
            ) : rows.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`${base}/checkouts/${encodeURIComponent(r.checkoutId)}`)}>
                <td className="px-3 py-2"><div className="font-medium">{r.checkoutId}</div><div className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</div></td>
                <td className="px-3 py-2"><div>{r.customer?.name || "—"}</div><div className="text-xs text-slate-500">{r.customer?.phone}</div></td>
                <td className="px-3 py-2">{r.orderCount} <span className="text-xs text-slate-500">({r.sellerCount} sellers)</span></td>
                <td className="px-3 py-2">{formatCurrency(r.grandTotal)}</td>
                <td className="px-3 py-2 capitalize">{label(r.payment?.method)} · {label(r.payment?.status)}</td>
                <td className="px-3 py-2 text-xs">{r.couponCode || "—"}{r.coinsUsed ? ` · ${r.coinsUsed} coins` : ""}</td>
                <td className="px-3 py-2 capitalize">{label(r.status)}</td>
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
