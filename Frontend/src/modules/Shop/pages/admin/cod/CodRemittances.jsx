import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Banknote, Loader2, Upload } from "lucide-react"
import { adminAPI } from "@store/api"
import { useAdminBase } from "@store/components/admin/useAdminPanel"
import { SummaryCard, formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"
import ShipmentTabs from "../shipments/ShipmentTabs"
import { LineStatus } from "./codShared"

const today = () => new Date().toISOString().slice(0, 10)
const EMPTY = { courier: "", reference: "", date: today(), note: "", csv: "" }

/**
 * Shop panel: courier COD remittances (record / import a payout and match it to
 * delivered COD shipments), with a read-only view of rider cash for Quick.
 */
export default function CodRemittances() {
  const base = useAdminBase()
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    return Promise.all([
      adminAPI.getCodRemittances({ page, limit: 20 }),
      adminAPI.getCodSummary(),
    ])
      .then(([list, sum]) => {
        const body = list?.data?.data || {}
        setRows(body.data || [])
        setMeta(body.meta || { total: 0, totalPages: 1 })
        setSummary(sum?.data?.data || null)
      })
      .catch((e) => toast.error(errorMessage(e, "Failed to load remittances")))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => { load() }, [load])

  const readFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setForm((f) => ({ ...f, csv: String(reader.result || "") })); setPreview(null) }
    reader.readAsText(file)
  }

  const runPreview = async () => {
    try {
      const res = await adminAPI.previewCodRemittance({ csv: form.csv })
      setPreview(res?.data?.data || null)
    } catch (e) {
      toast.error(errorMessage(e, "Could not read the remittance lines"))
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await adminAPI.createCodRemittance(form)
      const d = res?.data?.data || {}
      toast.success(`Recorded ${d.reference}: ${d.totals?.matched || 0} matched, ${d.totals?.short || 0} short, ${d.totals?.unexpected || 0} unexpected`)
      setForm(null)
      setPreview(null)
      await load()
    } catch (err) {
      toast.error(errorMessage(err, "Could not record the remittance"))
    } finally {
      setSaving(false)
    }
  }

  const r = summary?.riders
  const c = summary?.couriers

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Banknote className="w-5 h-5 text-slate-600" />
        <h1 className="text-xl font-semibold text-slate-900">COD Remittances</h1>
        <div className="ml-auto">
          <button type="button" onClick={() => { setForm(EMPTY); setPreview(null) }} className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm inline-flex items-center gap-1">
            <Upload className="w-4 h-4" /> Record remittance
          </button>
        </div>
      </div>
      <ShipmentTabs />

      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Couriers (Shop)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <SummaryCard label="COD delivered" value={formatCurrency(c?.deliveredAmount)} />
              <SummaryCard label="Remitted" value={formatCurrency(c?.remittedAmount)} tone="text-green-700" />
              <SummaryCard label="Outstanding" value={formatCurrency(c?.outstandingAmount)} hint={`${c?.outstandingCount || 0} shipments`} tone="text-amber-700" />
              <SummaryCard label="Remittances" value={c?.remittances || 0} />
            </div>
            {(c?.byCourier || []).length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr><th className="text-left py-1">Courier</th><th className="text-right">Delivered</th><th className="text-right">Remitted</th><th className="text-right">Pending</th></tr></thead>
                <tbody>
                  {c.byCourier.map((x) => (
                    <tr key={x.courier} className="border-t border-slate-100">
                      <td className="py-1">{x.courier}</td>
                      <td className="text-right">{formatCurrency(x.deliveredAmount)}</td>
                      <td className="text-right">{formatCurrency(x.remittedAmount)}</td>
                      <td className="text-right">{x.outstandingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Riders (Quick) <span className="font-normal text-slate-500">· read only, settled through cash deposits</span></h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <SummaryCard label="COD collected" value={formatCurrency(r?.collectedAmount)} hint={`${r?.collectedCount || 0} orders`} />
              <SummaryCard label="Cash in hand" value={formatCurrency(r?.cashInHand)} hint={`${r?.ridersHoldingCash || 0} riders`} tone="text-amber-700" />
              <SummaryCard label="Deposited" value={formatCurrency(r?.deposits?.completed?.amount)} tone="text-green-700" />
              <SummaryCard label="Deposits pending" value={formatCurrency(r?.deposits?.pending?.amount)} hint={`${r?.deposits?.pending?.count || 0}`} />
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["Date", "Courier", "UTR / reference", "Received", "Matched", "Short", "Excess", "Unexpected", "Duplicate"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No remittances recorded yet</td></tr>
            ) : rows.map((x) => (
              <tr key={x._id} className="hover:bg-slate-50">
                <td className="px-3 py-2">{formatDateTime(x.date)}</td>
                <td className="px-3 py-2">{x.courier}</td>
                <td className="px-3 py-2"><Link className="text-blue-600" to={`${base}/cod-remittances/${x._id}`}>{x.reference}</Link></td>
                <td className="px-3 py-2">{formatCurrency(x.totals?.received)}</td>
                <td className="px-3 py-2">{x.totals?.matched || 0}</td>
                <td className="px-3 py-2">{x.totals?.short || 0}</td>
                <td className="px-3 py-2">{x.totals?.excess || 0}</td>
                <td className="px-3 py-2">{x.totals?.unexpected || 0}</td>
                <td className="px-3 py-2">{x.totals?.duplicate || 0}</td>
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

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl p-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3 text-sm">
            <h2 className="font-semibold">Record a courier COD remittance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input required className="border border-slate-200 rounded-md px-2 py-2" placeholder="Courier (e.g. Delhivery)" value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} />
              <input required className="border border-slate-200 rounded-md px-2 py-2" placeholder="UTR / reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              <input required type="date" className="border border-slate-200 rounded-md px-2 py-2" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">AWB and amount per line (CSV: "awb,amount"; a header row is fine)</span>
                <label className="text-xs text-blue-600 cursor-pointer">Import CSV
                  <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
                </label>
              </div>
              <textarea required rows={6} className="w-full border border-slate-200 rounded-md px-2 py-2 font-mono text-xs" placeholder={"awb,amount\nAWB123,499\nAWB124,1250"} value={form.csv} onChange={(e) => { setForm({ ...form, csv: e.target.value }); setPreview(null) }} />
            </div>
            <input className="w-full border border-slate-200 rounded-md px-2 py-2" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />

            {preview && (
              <div className="border border-slate-200 rounded-md max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="text-left px-2 py-1">AWB</th><th className="text-left">Order</th><th className="text-right">Amount</th><th className="text-right">Expected</th><th className="text-left px-2">Result</th></tr></thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={`${l.awb}-${i}`} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono">{l.awb}</td>
                        <td>{l.orderCode || "—"}</td>
                        <td className="text-right">{formatCurrency(l.amount)}</td>
                        <td className="text-right">{l.expected == null ? "—" : formatCurrency(l.expected)}</td>
                        <td className="px-2"><LineStatus status={l.status} /> <span className="text-slate-500">{l.note}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 rounded-md border" onClick={() => setForm(null)}>Close</button>
              <button type="button" disabled={!form.csv.trim()} onClick={runPreview} className="px-3 py-1.5 rounded-md border border-slate-900 disabled:opacity-50">Check matches</button>
              <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-60">{saving ? "Saving..." : "Save and mark remitted"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
