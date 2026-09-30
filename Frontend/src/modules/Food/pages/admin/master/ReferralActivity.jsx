import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { platformSettingsAPI } from "@food/api"

/**
 * Who referred whom, what it paid and why a reward was refused, across the
 * services (Backend core/referral/referralActivity.service.js), Rides included.
 */
const STATUS_STYLE = {
  credited: "bg-green-50 text-green-700",
  pending: "bg-amber-50 text-amber-700",
  rejected: "bg-neutral-100 text-neutral-600",
}
const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`
const when = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "")
const person = (p) => [p?.name, p?.phone].filter(Boolean).join(" · ") || "Unknown"
const reasonText = (r) => String(r || "").replace(/_/g, " ")

export default function ReferralActivity() {
  const [filters, setFilters] = useState({ service: "", status: "", from: "", to: "" })
  const [data, setData] = useState({ items: [], summary: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError("")
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    platformSettingsAPI
      .referralActivity({ ...params, limit: 200 })
      .then((res) => alive && setData(res?.data?.data || { items: [], summary: [] }))
      .catch((err) => alive && setError(err?.response?.data?.message || "Could not load referral activity."))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [filters])

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))
  const field = "mt-1 block rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-base font-semibold text-neutral-900">Referral activity</h2>
      <p className="mt-1 text-sm text-neutral-500">Every invite that was redeemed, what it paid, and why a reward was refused.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.summary.map((s) => (
          <div key={s.service} className="rounded-lg border border-neutral-200 p-3">
            <p className="text-xs font-semibold uppercase text-neutral-500">{s.label}</p>
            <p className="mt-1 text-lg font-bold text-neutral-900">{money(s.rewardsPaid)}</p>
            <p className="text-xs text-neutral-500">
              {s.credited} paid · {s.pending} pending · {s.rejected} refused
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="text-xs text-neutral-600">
          Service
          <select value={filters.service} onChange={set("service")} className={field}>
            <option value="">All</option>
            {data.summary.map((s) => <option key={s.service} value={s.service}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-neutral-600">
          Status
          <select value={filters.status} onChange={set("status")} className={field}>
            <option value="">All</option>
            <option value="credited">Paid</option>
            <option value="pending">Pending</option>
            <option value="rejected">Refused</option>
          </select>
        </label>
        <label className="text-xs text-neutral-600">
          From
          <input type="date" value={filters.from} onChange={set("from")} className={field} />
        </label>
        <label className="text-xs text-neutral-600">
          To
          <input type="date" value={filters.to} onChange={set("to")} className={field} />
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-neutral-400" /></div>
        ) : error ? (
          <p className="py-6 text-sm text-red-600">{error}</p>
        ) : !data.items.length ? (
          <p className="py-6 text-sm text-neutral-500">No referrals match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Service</th>
                <th className="py-2 pr-4">Referred by</th>
                <th className="py-2 pr-4">New user</th>
                <th className="py-2 pr-4">Reward</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.key} className="border-t border-neutral-100 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{when(r.createdAt)}</td>
                  <td className="py-2 pr-4">
                    {r.serviceLabel}
                    {r.role === "rider" ? <span className="ml-1 text-xs text-neutral-400">(rider)</span> : null}
                  </td>
                  <td className="py-2 pr-4">{person(r.referrer)}</td>
                  <td className="py-2 pr-4">{person(r.referee)}</td>
                  <td className="py-2 pr-4 font-medium">{money(r.reward)}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] || STATUS_STYLE.pending}`}>
                      {r.status === "rejected" ? "refused" : r.status === "credited" ? "paid" : r.status}
                    </span>
                    {r.reason ? <p className="mt-1 text-xs text-neutral-400">{reasonText(r.reason)}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
