import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BarChart3 } from "lucide-react"
import { adminAIAPI } from "@store/api"

const errorMessage = (e, fallback) => e?.response?.data?.message || e?.message || fallback
const n = (v) => Number(v || 0).toLocaleString()
const usd = (v) => `$${Number(v || 0).toFixed(4)}`
const isoDay = (d) => d.toISOString().slice(0, 10)

function Card({ label, value, hint, tone = "text-slate-900" }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  )
}

export default function AiUsage() {
  const [range, setRange] = useState(() => ({ from: isoDay(new Date(Date.now() - 29 * 86400000)), to: isoDay(new Date()) }))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAIAPI.getUsage(range)
      .then((res) => { if (!cancelled) setData(res?.data?.data || null) })
      .catch((e) => { if (!cancelled) toast.error(errorMessage(e, "Failed to load AI usage")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range])

  const daily = data?.daily || []
  const maxTokens = Math.max(1, ...daily.map((d) => d.totalTokens))
  const month = data?.month || {}

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          <h1 className="text-xl font-bold text-slate-900">Assistant usage</h1>
        </div>
        <div className="flex items-end gap-2 text-xs text-slate-600">
          <label>From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="block mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" /></label>
          <label>To<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="block mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" /></label>
        </div>
      </div>

      {loading && !data && <div className="text-sm text-slate-500">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Card label="Messages" value={n(data.totals.messages)} hint={`${data.from} to ${data.to}`} />
            <Card label="Tokens" value={n(data.totals.totalTokens)} hint={`${n(data.totals.promptTokens)} in · ${n(data.totals.outputTokens)} out`} />
            <Card label="Estimated cost" value={usd(data.totals.estimatedCostUsd)} hint={`${data.model} at $${data.rates.inputCostPer1M}/$${data.rates.outputCostPer1M} per 1M`} />
            <Card
              label="This month's budget"
              value={month.budget ? `${n(month.tokens)} / ${n(month.budget)}` : `${n(month.tokens)} (no limit)`}
              hint={month.exhausted ? "Used up: the assistant is off until next month" : month.budget ? `${n(month.remaining)} tokens left` : ""}
              tone={month.exhausted ? "text-red-600" : "text-slate-900"}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-4">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2 text-right">Messages</th>
                  <th className="px-3 py-2 text-right">Model calls</th>
                  <th className="px-3 py-2 text-right">Users</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 w-40"></th>
                  <th className="px-3 py-2 text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {daily.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No usage in this range</td></tr>}
                {daily.map((d) => (
                  <tr key={d.day} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">{d.day}</td>
                    <td className="px-3 py-2 text-right">{n(d.messages)}</td>
                    <td className="px-3 py-2 text-right">{n(d.llmCalls)}</td>
                    <td className="px-3 py-2 text-right">{n(d.activeUsers)}</td>
                    <td className="px-3 py-2 text-right">{n(d.totalTokens)}</td>
                    <td className="px-3 py-2">
                      <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-indigo-500" style={{ width: `${(d.totalTokens / maxTokens) * 100}%` }} /></div>
                    </td>
                    <td className="px-3 py-2 text-right">{usd(d.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <div className="px-3 py-2 font-semibold text-slate-800 border-b">Top users</div>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-right">Messages</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No signed-in usage</td></tr>}
                {data.topUsers.map((u) => (
                  <tr key={u.userId} className="border-t border-slate-100">
                    <td className="px-3 py-2">{u.user?.name || u.user?.phone || u.user?.email || u.userId}</td>
                    <td className="px-3 py-2 text-right">{n(u.messages)}</td>
                    <td className="px-3 py-2 text-right">{n(u.tokens)}</td>
                    <td className="px-3 py-2 text-right">{usd(u.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
