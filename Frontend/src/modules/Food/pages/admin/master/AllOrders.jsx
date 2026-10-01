import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Search } from "lucide-react"
import { platformOrdersAPI } from "@food/api"

/**
 * Master > All Orders.
 *
 * Every service's orders, rides and bookings in one list, from the one common
 * order record (core/orders/platformOrder.model.js). Each admin sees only the
 * services whose orders they may read; the server decides.
 */

const SERVICE_LABEL = {
  food: "Food",
  quickCommerce: "Quick",
  ecommerce: "Shop",
  taxi: "Rides",
  serviceProvider: "Services",
}
const KIND_LABEL = { medical: "Medical", parcel: "Parcel", rental: "Rental" }
const SERVICE_COLOR = {
  food: "bg-orange-100 text-orange-800",
  quickCommerce: "bg-emerald-100 text-emerald-800",
  ecommerce: "bg-indigo-100 text-indigo-800",
  taxi: "bg-amber-100 text-amber-800",
  serviceProvider: "bg-sky-100 text-sky-800",
}
const STATUSES = [
  ["", "Any status"],
  ["placed", "Placed"],
  ["confirmed", "Confirmed"],
  ["preparing", "Preparing"],
  ["in_progress", "In progress"],
  ["out_for_delivery", "Out for delivery"],
  ["on_trip", "On trip"],
  ["delivered", "Delivered"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["refunded", "Refunded"],
]
const STATUS_COLOR = {
  delivered: "bg-emerald-50 text-emerald-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
  refunded: "bg-purple-50 text-purple-700",
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""
const humanize = (s) => String(s || "").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
const errorText = (err, fallback) => err?.response?.data?.message || fallback

export default function AllOrders() {
  const [filters, setFilters] = useState({ service: "", status: "", from: "", to: "", phone: "", partner: "", q: "" })
  const [applied, setApplied] = useState(filters)
  const [rows, setRows] = useState([])
  const [services, setServices] = useState([])
  const [nextBefore, setNextBefore] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (params, before) => {
    setLoading(true)
    setError("")
    try {
      const clean = Object.fromEntries(Object.entries({ ...params, before, limit: 50 }).filter(([, v]) => v))
      const res = await platformOrdersAPI.list(clean)
      const data = res?.data?.data || {}
      setServices(data.services || [])
      setRows((prev) => (before ? [...prev, ...(data.items || [])] : data.items || []))
      setNextBefore(data.nextBefore || null)
    } catch (err) {
      setError(errorText(err, "Could not load orders."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(applied)
  }, [applied, load])

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))
  const submit = (e) => {
    e.preventDefault()
    setApplied(filters)
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">All Orders</h1>
          <p className="text-sm text-neutral-500">Orders, rides and bookings from every service, newest first.</p>
        </div>
        <button
          type="button"
          onClick={() => load(applied)}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <form onSubmit={submit} className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-neutral-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <select value={filters.service} onChange={set("service")} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm">
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>{SERVICE_LABEL[s] || s}</option>
          ))}
        </select>
        <select value={filters.status} onChange={set("status")} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm">
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input type="date" value={filters.from} onChange={set("from")} aria-label="From" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
        <input type="date" value={filters.to} onChange={set("to")} aria-label="To" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
        <input value={filters.phone} onChange={set("phone")} placeholder="Customer phone" inputMode="tel" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
        <input value={filters.partner} onChange={set("partner")} placeholder="Store, seller, driver or vendor" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
        <input value={filters.q} onChange={set("q")} placeholder="Order number" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
        <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          <Search className="h-4 w-4" /> Apply
        </button>
      </form>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Partner</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Refunded</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Placed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={`${r.service}:${r.sourceId}`} className="align-top">
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SERVICE_COLOR[r.service] || "bg-neutral-100"}`}>
                    {KIND_LABEL[r.kind] || SERVICE_LABEL[r.service] || r.service}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-neutral-900">{r.number || String(r.sourceId).slice(-6).toUpperCase()}</p>
                  <p className="text-xs text-neutral-500">{r.summary || r.title}</p>
                  {r.couponCode && <p className="text-xs text-neutral-500">Coupon {r.couponCode}</p>}
                </td>
                <td className="px-3 py-2 tabular-nums text-neutral-700">{r.customerPhone || "—"}</td>
                <td className="px-3 py-2 text-neutral-700">{r.partner?.name || "—"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[r.status] || "bg-neutral-100 text-neutral-700"}`}>
                    {humanize(r.status)}
                  </span>
                  {r.rawStatus && r.rawStatus !== r.status && <p className="mt-0.5 text-xs text-neutral-400">{humanize(r.rawStatus)}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(r.amounts?.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(r.amounts?.paid)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.amounts?.refunded ? rupees(r.amounts.refunded) : "—"}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">
                  {humanize(r.payment?.method)}
                  {r.payment?.status && <span className="block text-neutral-400">{humanize(r.payment.status)}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-600">{when(r.createdAt)}</td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-neutral-500">No orders match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-center">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        ) : (
          nextBefore && (
            <button
              type="button"
              onClick={() => load(applied, nextBefore)}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Load more
            </button>
          )
        )}
      </div>
    </div>
  )
}
