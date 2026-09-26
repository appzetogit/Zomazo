import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Scale } from "lucide-react"
import { toast } from "sonner"
import { paymentReconciliationAPI } from "@store/api"

const STATUS_META = {
  ok: { label: "OK", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  amount_mismatch: { label: "Amount mismatch", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  not_captured: { label: "Not captured", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  missing_payment_id: { label: "Missing payment ID", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  gateway_error: { label: "Gateway error", cls: "bg-slate-100 text-slate-700 border-slate-300" },
}

const toInputDate = (d) => {
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const money = (n) =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function PaymentReconciliation() {
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(toInputDate(weekAgo))
  const [to, setTo] = useState(toInputDate(today))
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    if (from && to && from > to) {
      toast.error("The start date must be before the end date")
      return
    }
    setLoading(true)
    try {
      // Whole local days: from the start of `from` to the end of `to`.
      const params = {}
      if (from) params.from = new Date(`${from}T00:00:00`).toISOString()
      if (to) params.to = new Date(`${to}T23:59:59.999`).toISOString()
      const res = await paymentReconciliationAPI.getReconciliation(params)
      setReport(res?.data?.data || null)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to run reconciliation")
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => (showAll ? report?.rows : report?.issues) || [], [report, showAll])
  const issueCount = report?.issues?.length || 0
  const difference = report ? Math.round(((report.capturedTotal || 0) - (report.expectedTotal || 0)) * 100) / 100 : 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="h-6 w-6" /> Payment Reconciliation
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Online payments we recorded as paid, checked against the payment gateway
            {report?.gateway ? ` (${report.gateway})` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">From</label>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">To</label>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run check
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Payments checked</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{report?.checked ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-500">Capped at 500 per run</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Expected total</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{report ? money(report.expectedTotal) : "—"}</p>
          <p className="mt-1 text-xs text-slate-500">What our orders say was paid</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Captured total</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{report ? money(report.capturedTotal) : "—"}</p>
          <p className={`mt-1 text-xs ${difference === 0 ? "text-slate-500" : "text-rose-600 font-semibold"}`}>
            {report ? `Difference ${difference >= 0 ? "+" : ""}${money(difference)}` : "What the gateway reports"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">By status</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {report && Object.keys(report.summary || {}).length ? (
              Object.entries(report.summary).map(([status, count]) => (
                <span
                  key={status}
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${(STATUS_META[status] || STATUS_META.gateway_error).cls}`}
                >
                  {(STATUS_META[status] || { label: status }).label}: {count}
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-400">{report ? "Nothing to check" : "—"}</span>
            )}
          </div>
        </div>
      </div>

      {/* Issues */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            {issueCount ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {showAll ? "All checked payments" : `Issues (${issueCount})`}
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all rows
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Reference</th>
                <th className="px-4 py-3 text-left">Payment ID</th>
                <th className="px-4 py-3 text-right">Expected</th>
                <th className="px-4 py-3 text-right">Captured</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    {report ? (showAll ? "No online payments in this range." : "No issues found. Every payment matches the gateway.") : "Run a check to see results."}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const meta = STATUS_META[r.status] || { label: r.status, cls: STATUS_META.gateway_error.cls }
                  return (
                    <tr key={`${r.kind}-${r.ref}-${i}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{r.ref || "—"}</p>
                        <p className="text-xs capitalize text-slate-500">{r.kind}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{r.paymentId || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{money(r.expected)}</td>
                      <td className="px-4 py-3 text-right font-medium">{money(r.captured)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {r.error || (r.gatewayStatus ? `Gateway status: ${r.gatewayStatus}` : "—")}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
