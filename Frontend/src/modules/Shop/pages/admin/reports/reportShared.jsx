import { useState } from "react"
import { BarChart3, Calendar, ChevronDown, FileSpreadsheet, Loader2 } from "lucide-react"
import { toast } from "sonner"

const iso = (d) => d.toISOString().slice(0, 10)

export function defaultRange(days = 30) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: iso(from), to: iso(to) }
}

export const formatCurrency = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const formatNumber = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-IN"))
export const formatDateTime = (d) => (d ? new Date(d).toLocaleString("en-IN") : "—")

/** Builds query params from the filter state, dropping empty values. */
export function toParams(filters) {
  const params = {}
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  if (filters.fulfilmentMode && filters.fulfilmentMode !== "all") params.fulfilmentMode = filters.fulfilmentMode
  return params
}

export function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

/** Downloads a server-generated .xlsx (the API call must use responseType: "blob"). */
export function useXlsxDownload(exportFn, name) {
  const [exporting, setExporting] = useState(false)
  const download = async (params) => {
    try {
      setExporting(true)
      const res = await exportFn(params)
      const blob = res?.data instanceof Blob ? res.data : new Blob([res?.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${name}_${params.from || ""}_${params.to || ""}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error("Export failed")
    } finally {
      setExporting(false)
    }
  }
  return { exporting, download }
}

export function ReportPage({ title, children }) {
  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <BarChart3 className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputCls =
  "w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"

/**
 * Date range (+ optional fulfilment mode) filter bar. `draft` is edited
 * locally and applied with the Filter button.
 */
export function ReportFilters({ value, onApply, showMode = true, showRange = true, onExport, exporting }) {
  const [draft, setDraft] = useState(value)
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {showRange && (
          <>
            <div className="relative flex-1 min-w-0">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="date" aria-label="From date" value={draft.from} max={draft.to}
                onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value }))} className={inputCls} />
            </div>
            <div className="relative flex-1 min-w-0">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="date" aria-label="To date" value={draft.to} min={draft.from}
                onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))} className={inputCls} />
            </div>
          </>
        )}
        {showMode && (
          <div className="relative flex-1 min-w-0">
            <select
              aria-label="Fulfilment mode"
              value={draft.fulfilmentMode || "all"}
              onChange={(e) => setDraft((p) => ({ ...p, fulfilmentMode: e.target.value }))}
              className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
            >
              <option value="all">All modes</option>
              <option value="quick">Quick</option>
              <option value="standard">Standard</option>
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
        )}
        <button
          onClick={() => onApply(draft)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all whitespace-nowrap"
        >
          Filter
        </button>
        {onExport && (
          <button
            onClick={() => onExport(draft)}
            disabled={exporting}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all whitespace-nowrap flex items-center gap-1.5 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            Export Excel
          </button>
        )}
      </div>
    </div>
  )
}

export function SummaryCard({ label, value, hint, tone = "text-slate-900" }) {
  return (
    <div className="rounded-lg shadow-sm border border-slate-200 p-3" style={{ backgroundColor: "#f1f5f9" }}>
      <p className="text-xs text-slate-600">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  )
}

/** columns: [{ key, label, render?, align? }] */
export function ReportTable({ title, columns, rows, footer, empty = "No data for this range", loading }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
      <h2 className="text-base font-bold text-slate-900 mb-3">
        {title} <span className="text-slate-500 font-normal">{rows.length}</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-semibold text-slate-700 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">{empty}</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.key ?? i} className="hover:bg-slate-50">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                      {c.render ? c.render(r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && !loading && rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-300 font-bold bg-slate-50">
              <tr>
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.render ? c.render(footer) : footer[c.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
