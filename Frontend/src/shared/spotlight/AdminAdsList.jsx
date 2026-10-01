import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Search, Pause, Play, Pencil, X } from "lucide-react"
import { spotlightAdminAPI, listOf, errorOf, fmtDate, dateInput, STATE_STYLE, KIND_LABEL } from "./api"

/**
 * Advertisement > Ads List: approved partner ads for one service, with their
 * running / scheduled / expired / paused state. Requests waiting for a decision
 * are on Ad Requests.
 */
export default function AdminAdsList({ service, requestsPath = "requests" }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ state: "", kind: "", q: "" })
  const [editing, setEditing] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      setItems(listOf(await spotlightAdminAPI.list({ service, ...filters })))
    } catch (err) {
      toast.error(errorOf(err, "Could not load ads"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, filters.state, filters.kind, filters.q])

  const save = async (id, body, done = "Saved") => {
    try {
      await spotlightAdminAPI.update(id, body)
      toast.success(done)
      setEditing(null)
      load()
    } catch (err) {
      toast.error(errorOf(err, "Could not save"))
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Ads List</h1>
              <p className="text-sm text-slate-500 mt-1">Approved partner ads. Running banners show in the home promotion strip.</p>
            </div>
            <Link to={requestsPath} className="text-sm font-medium text-blue-600 hover:underline">Ad requests →</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Search title or partner"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <select value={filters.state} onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
              <option value="">All states</option>
              <option value="running">Running</option>
              <option value="scheduled">Scheduled</option>
              <option value="expired">Expired</option>
              <option value="paused">Paused</option>
            </select>
            <select value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
              <option value="">All types</option>
              <option value="banner">Banner</option>
              <option value="listing">Promoted listing</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-3">Ad</th>
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No ads yet. Approved requests appear here.</td></tr>
              ) : items.map((ad) => (
                <tr key={ad.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {ad.imageUrl ? <img src={ad.imageUrl} alt="" className="w-16 h-10 object-cover rounded" /> : null}
                      <div>
                        <div className="font-medium text-slate-900">{ad.title}</div>
                        {ad.budgetNote ? <div className="text-xs text-slate-500">{ad.budgetNote}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{ad.partnerName || "-"}</td>
                  <td className="px-4 py-3">{KIND_LABEL[ad.kind]}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(ad.startDate)} – {fmtDate(ad.endDate)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATE_STYLE[ad.state] || ""}`}>{ad.state}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {ad.status === "paused" ? (
                        <button type="button" onClick={() => save(ad.id, { paused: false }, "Resumed")} className="p-2 rounded hover:bg-slate-100" title="Resume"><Play className="w-4 h-4" /></button>
                      ) : (
                        <button type="button" onClick={() => save(ad.id, { paused: true }, "Paused")} className="p-2 rounded hover:bg-slate-100" title="Pause"><Pause className="w-4 h-4" /></button>
                      )}
                      <button type="button" onClick={() => setEditing({ ...ad, startDate: dateInput(ad.startDate), endDate: dateInput(ad.endDate) })} className="p-2 rounded hover:bg-slate-100" title="Edit"><Pencil className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            className="bg-white rounded-xl w-full max-w-md p-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              save(editing.id, {
                title: editing.title,
                ctaLink: editing.ctaLink,
                budgetNote: editing.budgetNote,
                startDate: editing.startDate,
                endDate: editing.endDate,
              })
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Edit ad</h2>
              <button type="button" onClick={() => setEditing(null)}><X className="w-4 h-4" /></button>
            </div>
            <label className="block text-sm">Title
              <input required maxLength={120} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </label>
            <label className="block text-sm">Link (app path or https://)
              <input value={editing.ctaLink} onChange={(e) => setEditing({ ...editing, ctaLink: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Start
                <input type="date" required value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg" />
              </label>
              <label className="block text-sm">End
                <input type="date" required value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg" />
              </label>
            </div>
            <label className="block text-sm">Budget / price note
              <input maxLength={200} value={editing.budgetNote} onChange={(e) => setEditing({ ...editing, budgetNote: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </label>
            <button type="submit" className="w-full py-2 rounded-lg bg-blue-600 text-white font-medium">Save</button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
