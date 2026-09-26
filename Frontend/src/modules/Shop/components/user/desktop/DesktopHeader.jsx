import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ChevronDown, MapPin, Menu, Search, ShoppingCart, User, X, ChevronRight } from "lucide-react"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useCart } from "@store/context/CartContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { useProfile } from "@store/context/ProfileContext"
import { clearHomeScrollState } from "@store/utils/homeScrollRestore"
import { BRAND_LOGO_ON_DARK } from "@/config/brandMark"
import { useLocationSelector } from "../UserLayout"
import { useBusinessSettings, usePublicCategories } from "./useDesktopShell"
import { locationPincode, useQuickEta } from "./useDeliveryEstimates"
import { useQuickCartPanel } from "./quick/QuickCartPanel"
import SearchSuggestions, { useSearchSuggestions, useSuggestionKeyboard } from "./SearchSuggestions"

// The orange category bar carries dark text (white on orange is unreadable).
const catItem =
  "rounded-[2px] border border-transparent px-2 hover:border-wh-text focus-visible:border-wh-text focus-visible:outline-2 focus-visible:outline-wh-nav text-wh-text"

// Hovered/focused items on the orange bar get a soft dark pill hover.
const navItem =
  "rounded-[6px] border border-transparent px-1.5 py-1 lg:px-2.5 hover:bg-black/15 focus-visible:bg-black/20 focus-visible:outline-2 focus-visible:outline-white text-white transition-colors"

const isSignedIn = () => {
  try {
    return localStorage.getItem("user_authenticated") === "true" || !!localStorage.getItem("user_accessToken")
  } catch {
    return false
  }
}

function AccountMenu({ firstName, signedIn, storePath }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const closeTimer = useRef(null)
  const show = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const items = signedIn
    ? [
        ["Your profile", "/profile"],
        ["Your orders", "/orders"],
        ["Coins", "/coins"],
        ["Wallet", "/wallet"],
        ["Wishlist", "/profile/favorites"],
        ["Sign out", "/profile/logout"],
      ]
    : [["Sign in", "/auth/login"]]

  return (
    <div
      ref={ref}
      className="relative h-full"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false)
      }}
    >
      <Link
        to={signedIn ? "/profile" : "/auth/login"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${navItem} flex h-full flex-col justify-center leading-tight`}
      >
        <User className="h-6 w-6 lg:hidden" aria-hidden />
        <span className="hidden text-[12px] lg:inline">Hello, {signedIn ? firstName || "there" : "sign in"}</span>
        <span className="hidden items-center gap-0.5 text-[14px] font-bold lg:flex">
          Account &amp; Lists <ChevronDown className="h-3 w-3" aria-hidden />
        </span>
        <span className="sr-only">{signedIn ? "Your account" : "Sign in"}</span>
      </Link>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-50 w-56 rounded-[8px] border border-wh-border bg-wh-surface p-2 text-wh-text shadow-xl">
          {!signedIn ? (
            <p className="px-3 pb-2 pt-1 text-[12px] text-wh-muted">Sign in to see orders, coins and your wallet.</p>
          ) : null}
          {items.map(([label, to]) => (
            <Link
              key={to}
              role="menuitem"
              to={to}
              onClick={() => setOpen(false)}
              className="block rounded-[4px] px-3 py-1.5 text-[13px] hover:bg-[#F3F3F3] hover:text-wh-link-hover hover:underline"
            >
              {label}
            </Link>
          ))}
          <div className="my-1 border-t border-wh-border" />
          <Link role="menuitem" to={storePath("/cart")} onClick={() => setOpen(false)} className="block rounded-[4px] px-3 py-1.5 text-[13px] hover:bg-[#F3F3F3]">
            Your cart
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export function CategoryDrawer({ open, onClose, tree, storePath, brandName }) {
  const panelRef = useRef(null)
  const [expanded, setExpanded] = useState(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    panelRef.current?.querySelector("button, a")?.focus()
    const onKey = (e) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open, onClose])

  // Stay mounted for the closing slide, and start off-canvas on the opening one.
  useEffect(() => {
    if (!open) {
      setShown(false)
      return undefined
    }
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="All categories">
      <button
        type="button"
        aria-label="Close categories"
        onClick={onClose}
        className={`absolute inset-0 h-full w-full cursor-default bg-black/70 transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        className={`absolute left-0 top-0 flex h-full w-[86%] max-w-[365px] flex-col bg-wh-surface text-wh-text shadow-2xl transition-transform duration-300 ease-out ${
          shown ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* The band carries the header's colour, so the drawer reads as part of it. */}
        <div className="flex h-[56px] items-center justify-between gap-2 bg-gradient-to-r from-[#d95d08] via-[#ea580c] to-[#f97316] px-5 text-[17px] font-bold text-white">
          <span className="truncate">Hello, shop {brandName}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-full p-1 hover:bg-black/15">
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <h2 className="px-5 pb-1 pt-3 text-[16px] font-bold">Shop by category</h2>
          <ul>
            {tree.map((c) => (
              <li key={c.id}>
                <div className="flex items-center">
                  <Link
                    to={storePath(`/category/${c.slug}`)}
                    onClick={onClose}
                    className="min-w-0 flex-1 truncate px-5 py-3 text-[14px] hover:bg-[#EAEDED]"
                  >
                    {c.name}
                  </Link>
                  {c.children.length ? (
                    <button
                      type="button"
                      aria-expanded={expanded === c.id}
                      aria-label={`Show ${c.name} subcategories`}
                      onClick={() => setExpanded((v) => (v === c.id ? null : c.id))}
                      className="px-4 py-3 text-wh-muted hover:bg-[#EAEDED]"
                    >
                      <ChevronRight className={`h-4 w-4 transition-transform ${expanded === c.id ? "rotate-90" : ""}`} aria-hidden />
                    </button>
                  ) : null}
                </div>
                {expanded === c.id ? (
                  <ul className="bg-[#F7F8F8]">
                    {c.children.map((s) => (
                      <li key={s.id}>
                        <Link to={storePath(`/category/${s.slug}`)} onClick={onClose} className="block truncate px-9 py-2 text-[13px] hover:bg-[#EAEDED]">
                          {s.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {!tree.length ? <li className="px-5 py-3 text-wh-muted">No categories yet.</li> : null}
          </ul>
          <div className="mt-2 border-t border-wh-border pt-2">
            <Link to={storePath("/categories")} onClick={onClose} className="block px-5 py-3 text-[14px] hover:bg-[#EAEDED]">
              See all categories
            </Link>
            <Link to="/help" onClick={onClose} className="block px-5 py-3 text-[14px] hover:bg-[#EAEDED]">
              Help
            </Link>
          </div>
        </nav>
      </div>
    </div>
  )
}

/**
 * Desktop (lg+) storefront header: top bar + category bar, sticky.
 * Props: onOpenSpin() opens the existing Spin & Win modal.
 */
export default function DesktopHeader({ onOpenSpin, desktopOnly = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isQuick, storePath, fulfilmentMode } = useStoreMode()
  const { effectiveLocation, displayAddressText, zoneId, setCommerceMode } = useDeliveryLocation()
  const { getCartCount } = useCart()
  const { userProfile } = useProfile()
  const { openLocationSelector } = useLocationSelector()
  const { brandName, logoOnDark } = useBusinessSettings()
  const { categories, roots, tree } = usePublicCategories(zoneId)
  const quickEta = useQuickEta()
  const quickCart = useQuickCartPanel()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("")
  const [logoSrc, setLogoSrc] = useState(logoOnDark)
  useEffect(() => setLogoSrc(logoOnDark), [logoOnDark])

  // Keep the box in sync with the search page's ?q=.
  useEffect(() => {
    if (location.pathname.endsWith("/search")) {
      const params = new URLSearchParams(location.search)
      setQ(params.get("q") || "")
      setCat(params.get("cat") || "")
    }
  }, [location.pathname, location.search])

  const signedIn = isSignedIn()
  const firstName = String(userProfile?.name || userProfile?.fullName || "").trim().split(/\s+/)[0]
  const cartCount = getCartCount()
  const area = effectiveLocation?.area?.trim() || effectiveLocation?.city || ""
  const pin = locationPincode(effectiveLocation)
  const deliverLine2 = [area || displayAddressText || "Select location", pin].filter(Boolean).join(" ")

  const goToSearch = (term) => {
    const params = new URLSearchParams({ q: term })
    if (cat) params.set("cat", cat)
    navigate(`${storePath("/search")}?${params.toString()}`)
  }

  const submitSearch = (e) => {
    e.preventDefault()
    const term = q.trim()
    if (!term && cat) {
      const c = roots.find((r) => r.id === cat)
      if (c) return navigate(storePath(`/category/${c.slug}`))
    }
    if (!term) return undefined
    goToSearch(term)
    return undefined
  }

  const suggestions = useSearchSuggestions({
    term: q,
    categories,
    fulfilmentMode,
    zoneId,
  })

  const pickSuggestion = (item) => {
    if (item.type === "product") {
      navigate(storePath(`/product/${item.id}`))
      return
    }
    if (item.type === "category") {
      setQ("")
      navigate(storePath(`/category/${item.slug}`))
      return
    }
    setQ(item.label)
    goToSearch(item.label)
  }

  const search = useSuggestionKeyboard({
    items: suggestions,
    onPick: pickSuggestion,
    onSubmit: submitSearch,
  })

  const topCats = roots.slice(0, 6)

  const cartVisual = (
    <>
      <span className="relative">
        <ShoppingCart className="h-6 w-6 text-white lg:h-7 lg:w-7" aria-hidden />
        <span className="absolute -top-1.5 left-1/2 min-w-[20px] -translate-x-1/2 rounded-full bg-white px-1 text-center text-[12px] font-black leading-5 text-[#ea580c] shadow-xs">
          {cartCount > 99 ? "99+" : cartCount}
        </span>
      </span>
      <span className="hidden text-[14px] font-bold text-white lg:inline">Cart</span>
    </>
  )

  const subnavLink =
    "flex h-[32px] items-center whitespace-nowrap rounded-[4px] px-2.5 text-[13px] font-medium text-gray-800 hover:text-black hover:bg-gray-100 transition-colors"

  return (
    // desktopOnly: on Quick, phones get QuickMobileHeader instead (QUICK_MOBILE_SPEC.md).
    <header className={`wh-desktop sticky top-0 z-50 ${desktopOnly ? "hidden lg:block" : ""}`}>
      {/* Top bar (Rich Orange Gradient) */}
      <div className="bg-gradient-to-r from-[#d95d08] via-[#ea580c] to-[#f97316] shadow-sm">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-1 gap-y-2 px-2.5 py-2 lg:h-[62px] lg:flex-nowrap lg:gap-x-1 lg:px-[20px] lg:py-[6px]">
          {/* The category drawer's trigger; from lg it lives on the orange bar. */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Browse categories"
            className={`${navItem} shrink-0 lg:hidden`}
          >
            <Menu className="h-6 w-6 text-white" aria-hidden />
          </button>
          <Link
            to={storePath("/")}
            onClick={() => clearHomeScrollState()}
            className={`${navItem} flex shrink-0 items-center lg:mx-0`}
            aria-label={`${brandName} home`}
          >
            <img
              src={logoSrc}
              alt={brandName}
              className="h-[28px] w-auto max-w-[74px] object-contain drop-shadow-sm lg:h-[42px] lg:max-w-[145px]"
              onError={() => logoSrc !== BRAND_LOGO_ON_DARK && setLogoSrc(BRAND_LOGO_ON_DARK)}
            />
          </Link>

          <button type="button" onClick={openLocationSelector} className={`${navItem} flex min-w-0 shrink items-center gap-1 pb-0 text-left lg:shrink-0 lg:items-end lg:gap-1.5 lg:pb-1`}>
            <MapPin className="h-4 w-4 shrink-0 text-white lg:mb-0.5" aria-hidden />
            <span className="flex flex-col leading-tight">
              <span className="hidden text-[11px] font-medium text-white/80 lg:inline">Deliver to you</span>
              <span className="flex items-center gap-0.5 truncate text-[13px] font-bold text-white lg:text-[14px]">
                {effectiveLocation?.city || area || "Indore"} <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
              </span>
            </span>
          </button>

          <form
            role="search"
            onSubmit={search.submit}
            ref={search.boxRef}
            className="relative order-last mx-0 flex w-full min-w-0 items-center lg:order-none lg:mx-2 lg:w-auto lg:flex-1"
          >
            <div className="flex h-[42px] w-full overflow-hidden rounded-[8px] bg-white shadow-md focus-within:ring-2 focus-within:ring-white">
              <label className="sr-only" htmlFor="wh-search-cat">Search in</label>
              <select
                id="wh-search-cat"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="hidden max-w-[150px] shrink-0 cursor-pointer border-r border-gray-200 bg-gray-50 px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-100 focus:outline-none sm:block"
              >
                <option value="">All Categories</option>
                {roots.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="wh-search-q">Search {brandName}</label>
              <input
                id="wh-search-q"
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  search.setOpen(true)
                }}
                onFocus={() => search.setOpen(true)}
                onKeyDown={search.handleKeyDown}
                placeholder="Search for shirts, jackets, shoes and more..."
                autoComplete="off"
                role="combobox"
                aria-expanded={search.open && suggestions.length > 0}
                aria-controls="wh-search-suggestions"
                aria-autocomplete="list"
                className="min-w-0 flex-1 bg-white px-3.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
              <button type="submit" aria-label="Search" className="flex w-[48px] shrink-0 items-center justify-center bg-[#111827] hover:bg-[#1f2937] text-white transition-colors">
                <Search className="h-5 w-5 text-white" aria-hidden />
              </button>
            </div>
            {search.open && (
              <SearchSuggestions
                listId="wh-search-suggestions"
                items={suggestions}
                activeIndex={search.activeIndex}
                onPick={(item) => {
                  search.setOpen(false)
                  pickSuggestion(item)
                }}
                onHover={search.setActiveIndex}
              />
            )}
          </form>

          <div role="group" aria-label="Choose store" className="ml-auto flex shrink-0 items-center lg:mx-1 lg:ml-0">
            <div className="flex rounded-full bg-black/20 backdrop-blur-md p-0.5 border border-white/20">
              <button
                type="button"
                aria-pressed={!isQuick}
                onClick={() => setCommerceMode("standard")}
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition-all lg:px-3.5 lg:py-1 lg:text-[13px] ${!isQuick ? "bg-white text-gray-950 shadow-sm" : "text-white hover:bg-white/10"}`}
              >
                Shop
              </button>
              <button
                type="button"
                aria-pressed={isQuick}
                onClick={() => setCommerceMode("quick")}
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition-all lg:px-3.5 lg:py-1 lg:text-[13px] ${isQuick ? "bg-white text-gray-950 shadow-sm" : "text-white hover:bg-white/10"}`}
              >
                <span className="lg:hidden">Quick</span>
                <span className="hidden lg:inline">Quick - 10 min</span>
              </button>
            </div>
          </div>

          <div className="hidden lg:block">
            <AccountMenu firstName={firstName} signedIn={signedIn} storePath={storePath} />
          </div>

          <Link to="/orders" className={`${navItem} hidden shrink-0 flex-col justify-center leading-tight lg:flex`}>
            <span className="text-[11px] text-white/80 font-medium">Returns</span>
            <span className="text-[14px] font-bold text-white">&amp; Orders</span>
          </Link>

          {/* On /quick the cart button opens the slide-in panel; Shop still links to /cart. */}
          {isQuick && quickCart.enabled ? (
            <button
              type="button"
              onClick={quickCart.openPanel}
              aria-haspopup="dialog"
              aria-expanded={quickCart.open}
              aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
              className={`${navItem} relative flex shrink-0 items-end gap-1.5 pb-1`}
            >
              {cartVisual}
            </button>
          ) : (
            <Link
              to={storePath("/cart")}
              aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
              className={`${navItem} relative flex shrink-0 items-end gap-1.5 pb-1`}
            >
              {cartVisual}
            </Link>
          )}
        </div>
      </div>

      {/* Sub-navbar / Category bar (Clean White Bar with Orange All button) */}
      <nav aria-label="Categories" className="hidden border-b border-gray-200 bg-white shadow-xs lg:block">
        <div className="mx-auto flex h-[42px] max-w-[1500px] items-center gap-2 overflow-x-auto px-3 text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-hidden lg:px-[20px]">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-[32px] items-center gap-1.5 rounded-[4px] bg-gradient-to-r from-[#ea580c] to-[#f97316] px-3.5 font-bold text-white shadow-xs hover:opacity-95 transition-opacity"
          >
            <Menu className="h-4 w-4" aria-hidden /> All
          </button>
          {topCats.map((c) => (
            <Link key={c.id} to={storePath(`/category/${c.slug}`)} className={subnavLink}>
              {c.name}
            </Link>
          ))}
          <Link to="/offers" className={subnavLink}>Today&apos;s Deals</Link>
          <Link to="/coins" className={subnavLink}>Coins</Link>
          {onOpenSpin ? (
            <button type="button" onClick={onOpenSpin} className={subnavLink}>Spin &amp; Win</button>
          ) : (
            <Link to="/spin" className={subnavLink}>Spin &amp; Win</Link>
          )}
          <Link to="/seller/signup" className={subnavLink}>Sell on {brandName}</Link>
          <Link to="/help" className={subnavLink}>Help</Link>
        </div>
      </nav>

      <CategoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} tree={tree} storePath={storePath} brandName={brandName} />
    </header>
  )
}
