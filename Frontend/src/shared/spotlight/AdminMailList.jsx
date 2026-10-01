import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Search, Download, Mail } from "lucide-react"
import { mailListAdminAPI, errorOf, fmtDate } from "./api"
import NewsletterSender from "./NewsletterSender"

const SOURCES = [
  ["", "All sources"],
  ["food", "Food"],
  ["quick", "Quick"],
  ["shop", "Shop"],
  ["taxi", "Rides"],
  ["services", "Services"],
  ["other", "Other"],
]

/**
 * Subscribed Mail List: everyone on the newsletter, with search, a date range
 * and CSV export of exactly what the filters show.
 */
export default function AdminMailList({ defaultSource = "" }) {
  const [filters, setFilters] = useState({ q: "", source: defaultSource, from: "", to: "", status: "subscribed", sort: "newest" })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0, limit: 25 })
  const [loading, setLoading] = useState(true)

  const params = () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v))

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await mailListAdminAPI.list({ ...params(), page, limit: 25 })
        setData(res?.data?.data || { items: [], total: 0, limit: 25 })
      } catch (err) {
        toast.error(errorOf(err, "Could not load the mail list"))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page])

  const set = (k) => (e) => {
    setPage(1)
    setFilters((f) => ({ ...f, [k]: e.target.value }))
  }

  const exportCsv = async () => {
    try {
      const res = await mailListAdminAPI.exportCsv(params())
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `mail-list-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(errorOf(err, "Could not export"))
    }
  }

  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || 25)))

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-blue-600" />
              <h1 className="text-lg font-semibold text-slate-900">Subscribed Mail List</h1>
              <span className="text-sm text-slate-500">{data.total || 0}</span>
            </div>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filters.q} onChange={set("q")} placeholder="Search email" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <select value={filters.source} onChange={set("source")} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={filters.status} onChange={set("status")} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
              <option value="subscribed">Subscribed</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="">Everyone</option>
            </select>
            <input type="date" value={filters.from} onChange={set("from")} title="Subscribed from" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            <input type="date" value={filters.to} onChange={set("to")} title="Subscribed to" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Sources</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">
                  <button type="button" onClick={() => setFilters((f) => ({ ...f, sort: f.sort === "newest" ? "oldest" : "newest" }))}>
                    Subscribed {filters.sort === "newest" ? "↓" : "↑"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Loading...</td></tr>
              ) : data.items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Nobody here yet.</td></tr>
              ) : data.items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 break-all">{row.email}</td>
                  <td className="px-4 py-3 capitalize">{row.sources.join(", ") || "-"}</td>
                  <td className="px-4 py-3 capitalize">{row.status}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row.subscribedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="flex justify-end items-center gap-2 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border disabled:opacity-40">Prev</button>
            <span>{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border disabled:opacity-40">Next</button>
          </div>
        ) : null}

        <NewsletterSender sources={SOURCES} defaultSource={defaultSource} />
      </div>
    </div>
  )
}
