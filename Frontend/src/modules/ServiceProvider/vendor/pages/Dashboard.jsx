import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Bell, Wifi, WifiOff } from "lucide-react"
import { Card, Empty, Shell, Spinner, Stat, inr } from "../../components/partner/ui"
import BookingRow from "../components/BookingRow"
import RequestCard from "../components/RequestCard"
import { vendorNav } from "../nav"
import useVendorLive from "../useVendorLive"
import { BASE, storedVendor, vendorApi } from "../vendorApi"

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(false)
  const vendor = storedVendor()

  const loadStats = useCallback(async () => {
    try {
      const res = await vendorApi.stats()
      setStats(res?.data || null)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  const { requests, loaded, drop, connected } = useVendorLive(loadStats)

  useEffect(() => {
    loadStats()
    // Registration cannot carry a business name (the register endpoint ignores it),
    // so it was parked at sign-up; save it on the first approved visit.
    const parked = localStorage.getItem("spVendorBusinessName")
    if (parked) {
      vendorApi
        .profile()
        .then((res) => (res?.vendor?.businessName ? null : vendorApi.updateProfile({ businessName: parked })))
        .then(() => localStorage.removeItem("spVendorBusinessName"))
        .catch(() => {})
    }
  }, [loadStats])

  const s = stats?.stats || {}

  return (
    <Shell
      title={`Hi${vendor?.name ? `, ${vendor.name.split(" ")[0]}` : ""}`}
      subtitle={vendor?.businessName || "Service vendor"}
      nav={vendorNav(requests.length)}
      right={
        <span
          title={connected ? "Live updates on" : "Reconnecting; checking every 20 seconds"}
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
            connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {connected ? "Live" : "Offline"}
        </span>
      }
    >
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Bell className="h-4 w-4" /> Incoming requests
          </h2>
          {requests.length > 0 && <span className="text-xs font-semibold text-amber-700">{requests.length} waiting</span>}
        </div>
        {!loaded ? (
          <Spinner />
        ) : requests.length ? (
          <div className="space-y-3">
            {requests.map((r) => (
              <RequestCard key={r.bookingId} request={r} onDone={drop} />
            ))}
          </div>
        ) : (
          <Empty title="No new requests" hint="Keep this screen open; new bookings ring here." />
        )}
      </section>

      {error && !stats ? (
        <Card className="text-sm text-rose-700">Could not load your numbers. They will retry in a few seconds.</Card>
      ) : !stats ? (
        <Spinner />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3">
            <Stat label="Earnings" value={inr(s.vendorEarnings ?? s.totalRevenue)} tone="text-emerald-700" />
            <Stat label="Rating" value={s.rating ? `${s.rating} ★` : "New"} />
            <Stat label="In progress" value={s.inProgressBookings ?? 0} />
            <Stat label="Pending" value={s.pendingBookings ?? 0} />
            <Stat label="Completed" value={s.completedBookings ?? 0} />
            <Stat label="Workers online" value={s.workersOnline ?? 0} />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Recent bookings</h2>
              <Link to={`${BASE}/bookings`} className="text-sm font-semibold text-emerald-700">
                See all
              </Link>
            </div>
            {stats.recentBookings?.length ? (
              <div className="space-y-2">
                {stats.recentBookings.map((b) => (
                  <BookingRow key={b._id} booking={b} />
                ))}
              </div>
            ) : (
              <Empty title="No bookings yet" />
            )}
          </section>
        </>
      )}
    </Shell>
  )
}
