import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, CalendarCheck, Gift, Heart, LifeBuoy, Menu, Receipt, Search, UserRound, Wrench } from "lucide-react"
import SuperAppSwitcher from "../../../shared/superapp/SuperAppSwitcher"
import { ACCOUNT_PATH, ALL_ORDERS_PATH, SUPPORT_PATH } from "../../../shared/superapp/services"
import { cx, focusRing } from "../helpers"

const MENU = [
  { to: "/services/bookings", label: "My bookings", icon: CalendarCheck },
  { to: "/services/saved", label: "Saved services", icon: Heart },
  { to: "/services/refer", label: "Refer and earn", icon: Gift },
  { to: ACCOUNT_PATH, label: "Your account", icon: UserRound },
  { to: ALL_ORDERS_PATH, label: "All orders", icon: Receipt },
  { to: SUPPORT_PATH, label: "Help and support", icon: LifeBuoy },
]

/** My bookings, saved services, referrals, all orders and help, in one menu. */
function AccountMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Menu"
        className={cx("rounded-xl p-2 text-gray-700 hover:bg-gray-100", focusRing)}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? (
        <nav
          aria-label="Services menu"
          className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1.5 shadow-xl"
        >
          {MENU.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              className={cx(
                "flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-violet-50",
                pathname.startsWith(m.to) ? "text-violet-700" : "text-gray-800",
                focusRing
              )}
            >
              <m.icon className="h-4 w-4 text-violet-600" aria-hidden="true" />
              {m.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  )
}

/**
 * The bar across every Services screen: back to the platform (or up a level),
 * the search box, My bookings and the menu, with the super app's service
 * switcher underneath.
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
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 pt-3 pb-2">
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
        <form onSubmit={submit} className="relative min-w-0 flex-1" role="search">
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
          aria-label="My bookings"
          className={cx(
            "flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-bold",
            location.pathname.startsWith("/services/bookings") ? "bg-violet-50 text-violet-700" : "text-gray-700 hover:bg-gray-100",
            focusRing
          )}
        >
          <CalendarCheck className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">My bookings</span>
        </Link>
        <AccountMenu />
      </div>
      <div className="mx-auto max-w-5xl px-4 pb-2">
        <SuperAppSwitcher accent="#7C3AED" />
      </div>
    </header>
  )
}
