import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Loader2 } from "lucide-react"
import { adminAPI } from "@store/api"
import { useAdminBase } from "@store/components/admin/useAdminPanel"
import { SummaryCard, formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"
import { LineStatus } from "./codShared"

const FILTERS = ["all", "matched", "short", "excess", "unexpected", "duplicate", "missing"]

/** One courier remittance: each line's match, and delivered COD shipments it did not cover. */
export default function CodRemittanceDetail() {
  const { id } = useParams()
  const base = useAdminBase()
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")

  useEffect(() => {
    setLoading(true)
    adminAPI.getCodRemittanceById(id)
      .then((res) => setDoc(res?.data?.data || null))
      .catch((e) => toast.error(errorMessage(e, "Failed to load the remittance")))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
  if (!doc) return <div className="p-8 text-center text-slate-500">Remittance not found</div>

  const t = doc.totals || {}
  const missing = (doc.missing?.rows || []).map((m) => ({ awb: m.awb, orderCode: m.orderId, amount: null, expected: m.expected, status: "missing", note: `Delivered ${formatDateTime(m.deliveredAt)}, not in any remittance` }))
  const lines = filter === "missing" ? missing : filter === "all" ? [...doc.lines, ...missing] : doc.lines.filter((l) => l.status === filter)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Link to={`${base}/cod-remittances`} className="text-sm text-slate-600 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> COD remittances</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{doc.courier} · {doc.reference}</h1>
        <p className="text-sm text-slate-500">{formatDateTime(doc.date)}{doc.note ? ` · ${doc.note}` : ""}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <SummaryCard label="Received" value={formatCurrency(t.received)} />
        <SummaryCard label="Expected (matched lines)" value={formatCurrency(t.expected)} />
        <SummaryCard label="Matched" value={t.matched || 0} tone="text-green-700" />
        <SummaryCard label="Short" value={t.short || 0} tone="text-amber-700" />
        <SummaryCard label="Unexpected" value={(t.unexpected || 0) + (t.duplicate || 0)} tone="text-red-700" />
        <SummaryCard label="Missing" value={doc.missing?.count || 0} hint={formatCurrency(doc.missing?.amount)} tone="text-red-700" />
      </div>

      <div className="flex flex-wrap gap-1 text-sm">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full border capitalize ${filter === f ? "bg-slate-900 text-white border-slate-900" : "border-slate-200"}`}>{f}</button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["AWB", "Order", "Remitted", "Expected", "Result", "Note"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Nothing here</td></tr>
            ) : lines.map((l, i) => (
              <tr key={`${l.awb}-${i}`}>
                <td className="px-3 py-2 font-mono text-xs">{l.awb}</td>
                <td className="px-3 py-2">{l.orderCode || "—"}</td>
                <td className="px-3 py-2">{l.amount == null ? "—" : formatCurrency(l.amount)}</td>
                <td className="px-3 py-2">{l.expected == null ? "—" : formatCurrency(l.expected)}</td>
                <td className="px-3 py-2"><LineStatus status={l.status} /></td>
                <td className="px-3 py-2 text-slate-500">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
