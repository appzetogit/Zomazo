import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Star, X } from "lucide-react"
import { orderAPI } from "@/services/api"
import { isModuleAuthenticated } from "@store/utils/auth"

/**
 * "Rate your order experience" (QUICK_MOBILE_SPEC.md §1): after a delivered
 * Quick order that has no rating yet, a bar rises above the cart bar. Dismissing
 * it is remembered per order, so it does not come back for the same one.
 */

const DISMISSED_KEY = "wh-rate-nudge-dismissed-v1"

const readDismissed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"))
  } catch {
    return new Set()
  }
}

export default function QuickRateNudge() {
  const [order, setOrder] = useState(null)
  const [visible, setVisible] = useState(false)
  const signedIn = isModuleAuthenticated("user")

  useEffect(() => {
    if (!signedIn) return undefined
    let cancelled = false
    orderAPI
      .getOrders({ page: 1, limit: 10 })
      .then((res) => {
        const d = res?.data?.data
        const orders = d?.orders || (Array.isArray(d) ? d : []) || []
        const dismissed = readDismissed()
        const pending = orders.find(
          (o) =>
            String(o?.orderStatus || o?.status || "").toLowerCase() === "delivered" &&
            !o?.ratings?.seller?.rating &&
            !dismissed.has(String(o?._id || o?.orderId)),
        )
        if (!cancelled && pending) {
          setOrder(pending)
          // A beat after the page settles, so it reads as a nudge rather than a blocker.
          setTimeout(() => !cancelled && setVisible(true), 1800)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!order) return null

  const id = String(order._id || order.orderId)
  const items = Array.isArray(order.items) ? order.items : []
  const lead = items[0]?.name || "Your order"
  const more = items.length > 1 ? ` +${items.length - 1} more item${items.length > 2 ? "s" : ""}` : ""

  const dismiss = () => {
    setVisible(false)
    try {
      const set = readDismissed()
      set.add(id)
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-30)))
    } catch {
      /* storage unavailable: it simply may come back next visit */
    }
  }

  return (
    <div
      role="status"
      className={`fixed inset-x-0 bottom-[57px] z-[55] px-3 pb-[76px] transition-all duration-500 ease-out md:hidden ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-2xl bg-wh-surface p-3 shadow-xl ring-1 ring-black/5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-wh-text">Rate your order experience</span>
          <span className="block truncate text-[12px] text-wh-muted">
            {lead}
            {more}
          </span>
        </span>
        <Link
          to={`/orders/${id}`}
          onClick={dismiss}
          className="shrink-0 rounded-lg border border-wh-success px-3 py-1.5 text-[13px] font-bold text-wh-success"
        >
          RATE
        </Link>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-wh-muted">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
