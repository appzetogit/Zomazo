import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, CalendarCheck, Search, Wrench } from "lucide-react"
import { cx, focusRing } from "../helpers"

/**
 * The bar across every Services screen: back to the platform (or up a level),
 * the search box, and My bookings.
 */
export default function ServicesHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const onSearch = location.pathname.startsWith("/services/search")
  const [q, setQ] = useState(onSearch ? params.get("q") || "" : "")

  useEffect(() => {
    if (!onSearch) setQ("")
  }, [onSearch])

  const isHome = location.pathname === "/services" || location.pathname === "/services/"

  const submit = (e) => {
    e.preventDefault()
    const term = q.trim()
    navigate(term ? `/services/search?q=${encodeURIComponent(term)}` : "/services/search")
  }

  return (
    <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => (isHome ? navigate("/food/user") : navigate(-1))}
          className={cx("rounded-full p-2 text-gray-700 hover:bg-gray-100", focusRing)}
          aria-label={isHome ? "Back to the app" : "Back"}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link to="/services" className={cx("hidden items-center gap-1.5 rounded-lg sm:flex", focusRing)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-base font-extrabold text-gray-900">Services</span>
        </Link>
        <form onSubmit={submit} className="relative flex-1" role="search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => {
              if (!onSearch) navigate("/services/search")
            }}
            placeholder="Search for a service (AC repair, cleaning...)"
            aria-label="Search services"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-500 focus:bg-white"
            autoFocus={onSearch}
          />
        </form>
        <Link
          to="/services/bookings"
          className={cx(
            "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold",
            location.pathname.startsWith("/services/bookings") ? "bg-violet-50 text-violet-700" : "text-gray-700 hover:bg-gray-100",
            focusRing
          )}
        >
          <CalendarCheck className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">My bookings</span>
        </Link>
      </div>
    </header>
  )
}
