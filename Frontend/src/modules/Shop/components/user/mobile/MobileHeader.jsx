import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ChevronDown, MapPin, Menu, Mic, Search, ShoppingCart } from "lucide-react"
import { useCart } from "@store/context/CartContext"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { BRAND_LOGO_ON_DARK } from "@/config/brandMark"
import { useLocationSelector } from "../UserLayout"
import SearchSuggestions, { useSearchSuggestions, useSuggestionKeyboard } from "../desktop/SearchSuggestions"
import { useQuickEta } from "../desktop/useDeliveryEstimates"
import { useBusinessSettings, usePublicCategories } from "../desktop/useDesktopShell"
import { CategoryDrawer } from "../desktop/DesktopHeader"
import useTypewriter from "../quick-mobile/useTypewriter"

/**
 * The phone header from the mobile mockup (screen 1), for Shop and Quick:
 * menu, logo, delivery place with its ETA, the Shop | Quick switch and the
 * cart; then search. On a home page a row of category chips follows.
 * Inner pages draw their own top bar (MobileTopBar) instead.
 */

const SpeechRecognition =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null

const slugify = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

export default function MobileHeader() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isHome = pathname === "/" || /^\/quick\/?$/.test(pathname)
  const { storePath, fulfilmentMode, isQuick } = useStoreMode()
  const { effectiveLocation, setCommerceMode, zoneId } = useDeliveryLocation()
  const { openLocationSelector } = useLocationSelector()
  const { getCartCount } = useCart()
  const cartCount = getCartCount()
  const { categories, tree } = usePublicCategories(zoneId)
  const { brandName } = useBusinessSettings()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const eta = useQuickEta()

  const [q, setQ] = useState("")
  const [listening, setListening] = useState(false)

  const place = effectiveLocation?.area || effectiveLocation?.city || "Set location"

  // The placeholder types real category names, so it suggests things you can buy.
  const words = useMemo(() => {
    const names = categories.filter((c) => c.parentId).map((c) => c.name.toLowerCase())
    return (names.length ? names : ["t-shirts", "jeans", "kurtas"]).slice(0, 8)
  }, [categories])
  const typed = useTypewriter(words)

  const chips = useMemo(() => categories.filter((c) => c.parentId).slice(0, 12), [categories])

  const goToSearch = (term) => navigate(`${storePath("/search")}?${new URLSearchParams({ q: term })}`)
  const suggestions = useSearchSuggestions({ term: q, categories, fulfilmentMode, zoneId })
  const pick = (item) => {
    if (item.type === "product") return navigate(storePath(`/product/${item.id}`))
    if (item.type === "category") return navigate(storePath(`/category/${slugify(item.label)}`))
    setQ(item.label)
    return goToSearch(item.label)
  }
  const search = useSuggestionKeyboard({
    items: suggestions,
    onPick: pick,
    onSubmit: (e) => {
      e.preventDefault()
      if (q.trim()) goToSearch(q.trim())
    },
  })

  const listen = () => {
    if (!SpeechRecognition || listening) return
    const rec = new SpeechRecognition()
    rec.lang = "en-IN"
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript?.trim()
      if (said) {
        setQ(said)
        goToSearch(said)
      }
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }

  return (
    <>
    <header className="wh-desktop sticky top-0 z-50 w-full overflow-x-hidden bg-gradient-to-r from-[#EA580C] via-[#F97316] to-[#EA580C] pb-2.5 pt-2.5 text-white shadow-md lg:hidden">
      <div className="flex items-center gap-1.5 px-3">
        {isHome ? (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <Link to={storePath("/")} className="flex shrink-0 items-center pr-1" aria-label="The Warehouses home">
          <img src={BRAND_LOGO_ON_DARK} alt="" className="h-[28px] w-auto max-w-[80px] object-contain drop-shadow-sm" />
        </Link>

        <button
          type="button"
          onClick={openLocationSelector}
          className="flex min-w-0 max-w-[118px] flex-col text-left leading-tight"
        >
          <span className="flex items-center gap-0.5 text-[12px] font-bold">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{place}</span>
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          </span>
          <span className="truncate text-[10px] font-medium text-amber-100">
            {isQuick ? `Delivery in ${eta} min` : "Delivery in 2-4 days"}
          </span>
        </button>

        <div role="group" aria-label="Choose store" className="ml-auto flex shrink-0 items-center rounded-full border border-white/25 bg-black/20 p-0.5">
          <button
            type="button"
            aria-pressed={!isQuick}
            onClick={() => setCommerceMode("standard")}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-all ${!isQuick ? "bg-white text-gray-950 shadow-xs" : "text-white/90"}`}
          >
            Shop
          </button>
          <button
            type="button"
            aria-pressed={isQuick}
            onClick={() => setCommerceMode("quick")}
            className={`flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-all ${isQuick ? "bg-white text-gray-950 shadow-xs" : "text-white/90"}`}
          >
            <span className="text-amber-500" aria-hidden="true">
              ⚡
            </span>
            Quick
          </button>
        </div>

        <Link
          to={storePath("/cart")}
          aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
        >
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          {cartCount > 0 ? (
            <span key={cartCount} className="wh-pop absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-black leading-none text-[#EA580C]">
              {cartCount > 9 ? "9+" : cartCount}
            </span>
          ) : null}
        </Link>
      </div>

      <div className="mt-2 px-3">
        <form role="search" onSubmit={search.submit} ref={search.boxRef} className="relative w-full">
          <div className="flex h-10 w-full items-center gap-2 rounded-xl bg-white px-3 shadow-xs">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            <label htmlFor="wh-mobile-search" className="sr-only">
              Search
            </label>
            <input
              id="wh-mobile-search"
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                search.setOpen(true)
              }}
              onFocus={() => search.setOpen(true)}
              onKeyDown={search.handleKeyDown}
              placeholder={`Search "${typed}"`}
              autoComplete="off"
              role="combobox"
              aria-expanded={search.open && suggestions.length > 0}
              aria-controls="wh-mobile-suggestions"
              aria-autocomplete="list"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
            {SpeechRecognition ? (
              <button
                type="button"
                onClick={listen}
                aria-label={listening ? "Listening" : "Search by voice"}
                className={`shrink-0 p-1 text-[#EA580C] ${listening ? "wh-blink" : ""}`}
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {search.open ? (
            <SearchSuggestions
              listId="wh-mobile-suggestions"
              items={suggestions}
              activeIndex={search.activeIndex}
              onPick={(item) => {
                search.setOpen(false)
                pick(item)
              }}
              onHover={search.setActiveIndex}
            />
          ) : null}
        </form>
      </div>

      {isHome && chips.length ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((c) => (
            <Link
              key={c.id}
              to={storePath(`/category/${slugify(c.name)}`)}
              className="shrink-0 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-gray-800 shadow-2xs active:scale-95"
            >
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
    </header>
    <CategoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} tree={tree} storePath={storePath} brandName={brandName} />
    </>
  )
}
