import { useEffect, useMemo, useState } from "react"
import { Download, Loader2, Search } from "lucide-react"
import { adminAPI } from "@food/api"

/**
 * What was paid out to restaurants/sellers or riders, from their withdrawal
 * requests: an approved request is money disbursed, a pending one is owed.
 *
 * Works for food and quick commerce alike -- in the quick-commerce admin the
 * API client sends these calls to /qc/admin. These pages used to render an
 * empty sample table with no API behind it.
 */
const SOURCES = {
  restaurants: {
    title: "Restaurant disbursements",
    who: "Restaurant",
    load: (params) => adminAPI.getWithdrawals(params),
    name: (r) => r.restaurantName || "N/A",
    ref: (r) => r.restaurantIdString || "",
  },
  deliverymen: {
    title: "Rider disbursements",
    who: "Rider",
    load: (params) => adminAPI.getDeliveryWithdrawals(params),
    name: (r) => r.deliveryName || "N/A",
    ref: (r) => r.deliveryIdString || "",
  },
}

const STATUSES = ["all", "approved", "pending", "rejected"]
const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const day = (v) => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

/** `source` lets another panel (the Shop's sellers) bring its own loader and names. */
export default function DisbursementReport({ kind = "restaurants", source: custom = null }) {
  const source = custom || SOURCES[kind] || SOURCES.restaurants
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError("")
    source
      .load({ status, limit: 500 })
      .then((res) => {
        const d = res?.data?.data || res?.data || {}
        if (alive) setRows(Array.isArray(d.requests) ? d.requests : [])
      })
      .catch((err) => alive && setError(err?.response?.data?.message || "Could not load disbursements."))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [kind, status])

  const visible = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`) : null
    const end = to ? new Date(`${to}T23:59:59`) : null
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      const at = new Date(r.updatedAt || r.createdAt)
      if (start && at < start) return false
      if (end && at > end) return false
      if (q && !`${source.name(r)} ${source.ref(r)} ${r.transactionId || ""}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, from, to, search, source])

  const totals = useMemo(() => {
    const t = { approved: 0, pending: 0, rejected: 0 }
    for (const r of visible) {
      const s = String(r.status || "").toLowerCase()
      if (s in t) t[s] += Number(r.amount) || 0
    }
    return t
  }, [visible])

  const exportCsv = () => {
    const head = [source.who, "ID", "Amount", "Status", "Method", "Transaction ID", "Requested", "Updated"]
    const lines = visible.map((r) =>
      [source.name(r), source.ref(r), r.amount, r.status, r.paymentMethod || "", r.transactionId || "", day(r.createdAt), day(r.updatedAt)]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${kind}-disbursements.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const card = "rounded-xl border border-slate-200 bg-white p-4"

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{source.title}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={card}>
          <p className="text-xs text-slate-500">Paid out</p>
          <p className="text-xl font-bold text-green-700">{money(totals.approved)}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-slate-500">Pending</p>
          <p className="text-xl font-bold text-amber-600">{money(totals.pending)}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-slate-500">Rejected</p>
          <p className="text-xl font-bold text-slate-700">{money(totals.rejected)}</p>
        </div>
      </div>

      <div className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="text-xs text-slate-600">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm capitalize">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600 flex-1 min-w-[180px]">
          Search
          <span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1.5">
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${source.who}, ID or transaction`} className="w-full text-sm outline-none" />
          </span>
        </label>
        <button type="button" onClick={exportCsv} disabled={!visible.length} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
        </button>
      </div>

      <div className={`${card} overflow-x-auto p-0`}>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : !visible.length ? (
          <p className="p-6 text-sm text-slate-500">No disbursements match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">{source.who}</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id || r._id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{source.name(r)}</p>
                    <p className="text-xs text-slate-400">{source.ref(r)}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold">{money(r.amount)}</td>
                  <td className="px-4 py-3">{r.status}</td>
                  <td className="px-4 py-3">{r.paymentMethod || "-"}</td>
                  <td className="px-4 py-3">{r.transactionId || "-"}</td>
                  <td className="px-4 py-3">{day(r.createdAt)}</td>
                  <td className="px-4 py-3">{day(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
