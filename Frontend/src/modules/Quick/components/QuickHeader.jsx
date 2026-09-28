/**
 * The Quick header, after the Shop's QuickMobileHeader: an ETA-first top row
 * ("Delivery in 10 minutes", the area), then a sticky search row with a typing
 * placeholder and the cart. One header for every width.
 */
import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ChevronDown, Heart, MapPin, Search, ShoppingCart, User } from "lucide-react"
import SuperAppSwitcher from "@/shared/superapp/SuperAppSwitcher"
import { useQuickCart } from "../context/QuickCartContext"
import { useQuickLocation } from "../context/QuickLocationContext"
import { cx, focusRing } from "../helpers"

const PLACEHOLDER_WORDS = ["milk", "bread", "eggs", "fruits", "snacks", "cold drinks", "atta", "detergent"]

/** Types a word, holds it, deletes it, moves on. Still under reduced motion. */
function useTypewriter(words, { typeMs = 90, holdMs = 1400, deleteMs = 45 } = {}) {
  const [text, setText] = useState("")
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce || !words.length) {
      setText(words[0] || "")
      return undefined
    }
    let i = 0
    let len = 0
    let deleting = false
    let timer
    const tick = () => {
      const word = words[i % words.length]
      if (!deleting) {
        len += 1
        setText(word.slice(0, len))
        if (len === word.length) {
          deleting = true
          timer = setTimeout(tick, holdMs)
          return
        }
        timer = setTimeout(tick, typeMs)
      } else {
        len -= 1
        setText(word.slice(0, len))
        if (len === 0) {
          deleting = false
          i += 1
        }
        timer = setTimeout(tick, deleteMs)
      }
    }
    timer = setTimeout(tick, typeMs)
    return () => clearTimeout(timer)
  }, [words, typeMs, holdMs, deleteMs])
  return text
}

export default function QuickHeader({ etaMinutes = 10 }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { itemCount } = useQuickCart()
  const { areaLabel, zoneStatus, requestLocation, locating } = useQuickLocation()
  const isHome = /^\/quick\/?$/.test(pathname)
  const initialQ = new URLSearchParams(search).get("q") || ""
  const [q, setQ] = useState(initialQ)
  const typed = useTypewriter(PLACEHOLDER_WORDS)

  useEffect(() => setQ(initialQ), [initialQ])

  const submit = (e) => {
    e.preventDefault()
    const term = q.trim()
    if (term) navigate(`/quick/search?q=${encodeURIComponent(term)}`)
  }

  return (
    <header className="sticky top-0 z-40 bg-wh-brand-50 text-wh-text shadow-[0_1px_0_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 pt-3 lg:px-6">
        {isHome ? (
          <button type="button" onClick={requestLocation} className={cx("min-w-0 flex-1 text-left", focusRing)} aria-label="Change delivery location">
            <p className="flex items-center gap-1.5 text-[18px] font-black leading-6 tracking-tight">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-wh-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-wh-success" />
              </span>
              {zoneStatus === "out" ? "Not delivering here yet" : `Delivery in ${etaMinutes} minutes`}
            </p>
            <p className="flex items-center gap-1 truncate text-[12px] text-wh-muted">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{locating ? "Finding you…" : areaLabel || "Set your location"}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </p>
          </button>
        ) : (
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back" className={cx("rounded-full p-1.5 hover:bg-black/5", focusRing)}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {!isHome ? (
          <Link to="/quick" className={cx("flex-1 text-[17px] font-black tracking-tight", focusRing)}>
            Quick <span className="text-[12px] font-bold text-wh-success">· {etaMinutes} min</span>
          </Link>
        ) : null}
        <Link to="/quick/favorites" aria-label="Favourites" className={cx("hidden rounded-full bg-white p-2 shadow-sm sm:block", focusRing)}>
          <Heart className="h-5 w-5" aria-hidden="true" />
        </Link>
        <Link to="/quick/account" aria-label="Account, orders and help" className={cx("rounded-full bg-white p-2 shadow-sm", focusRing)}>
          <User className="h-5 w-5" aria-hidden="true" />
        </Link>
      </div>

      {/*
        Across to the super app's other services, and every order in one list.
        On the home screen only: inner screens pin their own bars (store
        sections, category rail, bill) just under this header's height, and
        keep the way home through the back arrow and the Quick title.
      */}
      {isHome ? (
        <div className="mx-auto max-w-[1500px] px-4 pt-2 lg:px-6">
          <SuperAppSwitcher showOrders accent="#B45309" />
        </div>
      ) : null}

      <form onSubmit={submit} role="search" className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-3 lg:px-6">
        <label className="relative flex-1">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wh-muted" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search "${typed}"`}
            className="h-11 w-full rounded-[10px] border border-wh-border bg-white pl-9 pr-3 text-[14px] outline-none focus:border-wh-brand-ink"
          />
        </label>
        <Link to="/quick/cart" aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
          className={cx("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-sm", focusRing)}>
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          {itemCount > 0 ? (
            <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#EA580C] px-1 text-center text-[11px] font-bold leading-[18px] text-white">
              {itemCount}
            </span>
          ) : null}
        </Link>
      </form>
    </header>
  )
}
