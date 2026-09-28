import { useCallback, useEffect, useState } from "react"
import { Search } from "lucide-react"
import { Button, Empty, Shell, Spinner, Tabs, inputClass } from "../../components/partner/ui"
import BookingRow from "../components/BookingRow"
import { vendorNav } from "../nav"
import useVendorLive from "../useVendorLive"
import { vendorApi } from "../vendorApi"

// The groups GET /vendors/bookings understands (vendorBookingController.getVendorBookings).
const TABS = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "Active" },
  { value: "assigned", label: "Assigned" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

const LIMIT = 20

export default function Bookings() {
  const [tab, setTab] = useState("all")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true)
      try {
        const res = await vendorApi.bookings({ status: tab, q: query || undefined, page: nextPage, limit: LIMIT })
        setItems((prev) => (nextPage === 1 ? res?.data || [] : [...prev, ...(res?.data || [])]))
        setPage(nextPage)
        setPages(res?.pagination?.pages || 1)
      } catch {
        if (nextPage === 1) setItems([])
      } finally {
        setLoading(false)
      }
    },
    [tab, query]
  )

  useEffect(() => {
    load(1)
  }, [load])

  // Status changes pushed over the socket refresh the first page in place.
  const { requests } = useVendorLive(() => load(1))

  return (
    <Shell title="Bookings" nav={vendorNav(requests.length)}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(q.trim())
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          className={`${inputClass} pl-9`}
          placeholder="Search by service or booking number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {loading && page === 1 ? (
        <Spinner />
      ) : items.length ? (
        <div className="space-y-2">
          {items.map((b) => (
            <BookingRow key={b._id} booking={b} />
          ))}
          {page < pages && (
            <Button variant="secondary" className="w-full" loading={loading} onClick={() => load(page + 1)}>
              Load more
            </Button>
          )}
        </div>
      ) : (
        <Empty title="No bookings here" hint={query ? "Try a different search." : undefined} />
      )}
    </Shell>
  )
}
