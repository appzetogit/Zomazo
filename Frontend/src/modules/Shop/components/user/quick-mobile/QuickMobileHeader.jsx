import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ChevronDown, Coins, Mic, Search, ShoppingCart, User } from "lucide-react"
import { catalogAPI, coinsAPI } from "@/services/api"
import { useCart } from "@store/context/CartContext"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { isModuleAuthenticated } from "@store/utils/auth"
import { useLocationSelector } from "../UserLayout"
import { useQuickEta } from "../desktop/useDeliveryEstimates"
import { usePublicCategories } from "../desktop/useDesktopShell"
import { mediaUrl } from "../desktop/desktopCart"
import SearchSuggestions, { useSearchSuggestions, useSuggestionKeyboard } from "../desktop/SearchSuggestions"
import { useQuickLayout } from "./QuickLayoutContext"
import useTypewriter from "./useTypewriter"

/**
 * The Quick storefront's phone header (QUICK_MOBILE_SPEC.md §1, Q1).
 *
 * On the Quick home: the ETA block ("Delivery in 10 minutes", distance,
 * address, wallet, profile) scrolls away, and the search box and theme tabs
 * stay pinned. On every other Quick page: a back button beside the pinned
 * search. Hidden from `lg`, where the desktop header takes over.
 */

const SpeechRecognition =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null

function EtaBlock() {
  const eta = useQuickEta()
  const { effectiveLocation, displayAddressText, setCommerceMode } = useDeliveryLocation()
  const { openLocationSelector } = useLocationSelector()
  const signedIn = isModuleAuthenticated("user")
  const [distanceKm, setDistanceKm] = useState(null)
  const [coins, setCoins] = useState(null)

  const lat = effectiveLocation?.latitude
  const lng = effectiveLocation?.longitude

  // How far the nearest Quick store is from the address.
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setDistanceKm(null)
      return undefined
    }
    let cancelled = false
    catalogAPI
      .getNearbyStores({ lat, lng, limit: 1, fulfilmentMode: "quick" })
      .then((res) => {
        const km = Number(res?.data?.data?.stores?.[0]?.distanceKm)
        if (!cancelled) setDistanceKm(Number.isFinite(km) ? km : null)
      })
      .catch(() => {
        if (!cancelled) setDistanceKm(null)
      })
    return () => {
      cancelled = true
    }
  }, [lat, lng])

  useEffect(() => {
    if (!signedIn) {
      setCoins(null)
      return undefined
    }
    let cancelled = false
    coinsAPI
      .getBalance()
      .then((res) => {
        const d = res?.data?.data
        const n = Number(d?.balance ?? d?.coins ?? d)
        if (!cancelled) setCoins(Number.isFinite(n) ? n : 0)
      })
      .catch(() => {
        if (!cancelled) setCoins(null)
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  const label = effectiveLocation?.label || effectiveLocation?.deliveryAddress?.label || "Deliver to"

  return (
    <div className="px-4 pb-3 pt-3">
      {/* Top right: the Shop | Quick switch (the way back to Shop), coins and account. */}
      <div className="mb-1.5 flex items-center justify-end gap-2">
        <div role="group" aria-label="Choose store" className="inline-flex items-center rounded-full border border-wh-border bg-wh-surface p-0.5 shadow-sm">
          <button
            type="button"
            aria-pressed="false"
            onClick={() => setCommerceMode("standard")}
            className="rounded-full px-3 py-1 text-[12px] font-bold text-wh-muted active:scale-95"
          >
            Shop
          </button>
          <button
            type="button"
            aria-pressed="true"
            className="flex items-center gap-0.5 rounded-full bg-wh-brand-ink px-3 py-1 text-[12px] font-bold text-white shadow-xs"
          >
            <span className="text-amber-300" aria-hidden="true">⚡</span>
            Quick
          </button>
        </div>
        {signedIn ? (
          <Link
            to="/coins"
            aria-label={`Coins: ${coins ?? 0}`}
            className="flex h-11 w-11 flex-col items-center justify-center rounded-full bg-wh-surface shadow-sm"
          >
            <Coins className="h-4 w-4 text-wh-brand-ink" aria-hidden="true" />
            <span className="text-[10px] font-bold leading-none text-wh-text">{coins ?? 0}</span>
          </Link>
        ) : null}
        <Link
          to={signedIn ? "/profile" : "/auth/login"}
          aria-label={signedIn ? "Your account" : "Sign in"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-wh-surface shadow-sm"
        >
          <User className="h-5 w-5 text-wh-text" aria-hidden="true" />
        </Link>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-wh-text">Delivery in</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {/* The number eases in whenever the address (and so the ETA) changes. */}
            <span key={eta} className="wh-reveal is-visible text-[27px] font-black leading-none tracking-tight text-wh-text">
              {eta} minutes
            </span>
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-wh-success opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-wh-success" />
            </span>
            {distanceKm != null ? (
              <span className="rounded-full bg-[#E6F4F1] px-2 py-0.5 text-[11px] font-bold text-[#0F766E]">
                {distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`} away
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={openLocationSelector}
            className="mt-1.5 flex max-w-full items-center gap-1 text-left text-[14px] text-wh-text"
          >
            <span className="shrink-0 font-black uppercase">{label} -</span>
            <span className="truncate">{displayAddressText}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </div>

      </div>
    </div>
  )
}

/** Icon tabs, one per theme, with an underline that slides to the chosen one. */
function ThemeTabs() {
  const { layout, activeSlug, setActiveSlug } = useQuickLayout()
  const listRef = useRef(null)
  const [bar, setBar] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const list = listRef.current
    const active = list?.querySelector(`[data-slug="${activeSlug}"]`)
    if (!active) return
    setBar({ left: active.offsetLeft, width: active.offsetWidth })
    active.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" })
  }, [activeSlug, layout.themes.length])

  if (layout.themes.length < 2) return null

  return (
    <div className="relative border-b border-wh-border">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Shop by theme"
        className="relative flex gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {layout.themes.map((theme) => {
          const active = theme.slug === activeSlug
          const icon = mediaUrl(theme.iconUrl)
          return (
            <button
              key={theme.slug}
              type="button"
              role="tab"
              aria-selected={active}
              data-slug={theme.slug}
              onClick={() => setActiveSlug(theme.slug)}
              className={`flex shrink-0 flex-col items-center gap-1 px-3 pb-2 pt-1 text-[12px] transition-colors ${
                active ? "font-bold text-wh-text" : "text-wh-muted"
              }`}
            >
              {icon ? (
                <img
                  src={icon}
                  alt=""
                  className={`h-6 w-6 object-contain transition-transform duration-300 ${active ? "scale-110" : "opacity-70"}`}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black transition-colors ${
                    active ? "bg-wh-brand text-wh-text" : "bg-wh-border text-wh-muted"
                  }`}
                >
                  {theme.label.slice(0, 1)}
                </span>
              )}
              {theme.label}
            </button>
          )
        })}
        <span
          aria-hidden="true"
          className="absolute bottom-0 h-[3px] rounded-t-full transition-all duration-300 ease-out"
          style={{
            left: bar.left + 10,
            width: Math.max(0, bar.width - 20),
            background: "var(--wh-text)",
          }}
        />
      </div>
    </div>
  )
}

/** The pinned search: typing placeholder, suggestions, and a mic where the browser can listen. */
/** The Quick cart, with its item count; it sits on the pinned search row so it never scrolls away. */
function CartButton() {
  const { getCartCount } = useCart()
  const count = getCartCount()
  return (
    <Link
      to="/quick/cart"
      aria-label={`Quick cart, ${count} item${count === 1 ? "" : "s"}`}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-wh-border bg-wh-surface shadow-sm"
    >
      <ShoppingCart className="h-5 w-5 text-wh-text" aria-hidden="true" />
      {count > 0 ? (
        <span key={count} className="wh-pop absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-[#EA580C] px-1 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-wh-brand-50">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  )
}

function SearchRow({ showBack }) {
  const navigate = useNavigate()
  const { storePath, fulfilmentMode } = useStoreMode()
  const { zoneId } = useDeliveryLocation()
  const { categories } = usePublicCategories(zoneId)
  const [q, setQ] = useState("")
  const [listening, setListening] = useState(false)

  // Placeholder words: the zone's own subcategories, so it suggests real things.
  const words = useMemo(() => {
    const names = categories.filter((c) => c.parentId).map((c) => c.name.toLowerCase())
    return (names.length ? names : ["milk", "atta", "chips", "fruits"]).slice(0, 8)
  }, [categories])
  const typed = useTypewriter(words)

  const goToSearch = (term) => navigate(`${storePath("/search")}?${new URLSearchParams({ q: term })}`)

  const suggestions = useSearchSuggestions({ term: q, categories, fulfilmentMode, zoneId })
  const pick = (item) => {
    if (item.type === "product") return navigate(storePath(`/product/${item.id}`))
    if (item.type === "category") return navigate(storePath(`/category/${item.slug}`))
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
    <div className="flex items-center gap-2 px-4 py-2">
      {showBack ? (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wh-surface shadow-sm"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
      <form role="search" onSubmit={search.submit} ref={search.boxRef} className="relative min-w-0 flex-1">
        <div className="flex h-11 items-center gap-2 rounded-xl border border-wh-border bg-wh-surface px-3 shadow-sm focus-within:border-wh-brand">
          <Search className="h-5 w-5 shrink-0 text-wh-text" aria-hidden="true" />
          <label htmlFor="wh-quick-search" className="sr-only">
            Search Quick
          </label>
          <input
            id="wh-quick-search"
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
            aria-controls="wh-quick-suggestions"
            aria-autocomplete="list"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-wh-text placeholder:text-wh-muted focus:outline-none"
          />
          {SpeechRecognition ? (
            <>
              <span aria-hidden="true" className="h-5 w-px bg-wh-border" />
              <button
                type="button"
                onClick={listen}
                aria-label={listening ? "Listening" : "Search by voice"}
                className={`shrink-0 rounded-full p-1 ${listening ? "wh-blink text-wh-brand-ink" : "text-wh-text"}`}
              >
                <Mic className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
        {search.open ? (
          <SearchSuggestions
            listId="wh-quick-suggestions"
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
      <CartButton />
    </div>
  )
}

export default function QuickMobileHeader() {
  const { pathname } = useLocation()
  const isHome = /^\/quick\/?$/.test(pathname)
  const [stuck, setStuck] = useState(false)

  // Give the pinned part a shadow once the ETA block has scrolled away.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="wh-desktop lg:hidden">
      {isHome ? (
        <div className="bg-wh-brand-50">
          <EtaBlock />
        </div>
      ) : null}
      <div
        className={`sticky top-0 z-50 bg-wh-brand-50 transition-shadow duration-300 ${stuck ? "shadow-md" : ""}`}
      >
        <SearchRow showBack={!isHome} />
        {isHome ? <ThemeTabs /> : null}
      </div>
    </div>
  )
}
