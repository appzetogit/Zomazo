import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight, Receipt } from "lucide-react"
import { ALL_ORDERS_PATH } from "../../../shared/superapp/services"
import { servicesAPI } from "../api"
import { useLoad } from "../hooks"
import { ACTIVE_STATUSES, EmptyState, Skeleton, StatusPill, Thumb, canReview, cx, focusRing, formatDate, formatMoney, isSignedIn, useRequireLogin } from "../helpers"

const TABS = [
  { id: "active", label: "Upcoming" },
  { id: "past", label: "Past" },
]

/** My bookings: upcoming (anything still in motion) and past. */
export default function Bookings() {
  const requireLogin = useRequireLogin()
  const signedIn = isSignedIn()
  useEffect(() => {
    requireLogin()
  }, [requireLogin])

  const [tab, setTab] = useState("active")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])

  // One list, split on the client: the API filters by exact status and the
  // "upcoming" set is eleven of them.
  const list = useLoad(
    () => (signedIn ? servicesAPI.bookings({ page, limit: 20 }) : Promise.resolve({ data: [], pagination: {} })),
    [signedIn, page]
  )

  useEffect(() => {
    if (!list.data) return
    setRows((prev) => (page === 1 ? list.data.data || [] : [...prev, ...(list.data.data || [])]))
  }, [list.data, page])

  const shown = useMemo(
    () => rows.filter((b) => (tab === "active") === ACTIVE_STATUSES.includes(b.status)),
    [rows, tab]
  )
  const more = (list.data?.pagination?.pages || 1) > page

  if (!signedIn) return null

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-gray-900">My bookings</h1>
        <Link
          to={ALL_ORDERS_PATH}
          className={cx("flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold text-violet-700 hover:bg-violet-50", focusRing)}
        >
          <Receipt className="h-4 w-4" aria-hidden="true" /> All orders
        </Link>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">Service bookings here; food, rides and shopping under All orders.</p>
      <div className="mt-3 flex gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx("flex-1 rounded-lg py-2 text-sm font-bold", tab === t.id ? "bg-white text-violet-700 shadow-sm" : "text-gray-600", focusRing)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {list.loading && !rows.length ? (
          Array.from({ length: 4 }, (_, n) => <Skeleton key={n} className="h-24" />)
        ) : list.error && !rows.length ? (
          <EmptyState
            title="Could not load your bookings"
            text={list.error}
            action={
              <button type="button" onClick={() => list.reload()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
                Try again
              </button>
            }
          />
        ) : shown.length ? (
          shown.map((b) => (
            <Link
              key={b._id}
              to={`/services/bookings/${b._id}`}
              className={cx("flex gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:border-violet-200", focusRing)}
            >
              <Thumb src={b.categoryIcon || b.serviceId?.iconUrl} name={b.serviceName} className="h-14 w-14 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-extrabold text-gray-900">{b.serviceName || b.serviceId?.title || "Service"}</p>
                  <StatusPill status={b.status} className="shrink-0" />
                </div>
                <p className="mt-0.5 text-xs text-gray-600">
                  {formatDate(b.scheduledDate)}
                  {b.scheduledTime ? `, ${b.scheduledTime}` : ""}
                </p>
                <p className="mt-1 flex items-center justify-between text-xs text-gray-500">
                  <span>
                    #{b.bookingNumber} · {formatMoney(b.finalAmount)}
                  </span>
                  {canReview(b) ? <span className="font-bold text-violet-700">Rate now</span> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <EmptyState
            title={tab === "active" ? "No upcoming bookings" : "No past bookings"}
            text={tab === "active" ? "Book a professional for anything around the home." : undefined}
            action={
              tab === "active" ? (
                <Link to="/services" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
                  Browse services
                </Link>
              ) : null
            }
          />
        )}
        {more ? (
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={list.loading}
            className={cx("w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-bold text-gray-700 disabled:opacity-60", focusRing)}
          >
            {list.loading ? "Loading..." : "Load older bookings"}
          </button>
        ) : null}
      </div>
    </div>
  )
}
