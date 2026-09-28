import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, ChevronRight, Loader2, AlertCircle, ShoppingBag } from "lucide-react"
import { orderAPI } from "@food/api"
import { ECOMMERCE_ENABLED } from "@/config/features"

/**
 * Every order the customer has placed, across Food, Quick, rides and
 * Services, from GET /platform/me/orders. Each row opens that service's own
 * detail screen through the `route` the server gives it; a row without one
 * (no customer screen exists for it yet) is shown but does not open.
 */

// Chips map to the server's filters. Rides covers taxi, parcel and rental;
// Quick covers groceries and medicines, which are ordered in the same app.
const SERVICE_CHIPS = [
  { key: "", label: "All" },
  { key: "food", label: "Food" },
  { key: "quick_all", label: "Quick" },
  { key: "rides", label: "Rides" },
  { key: "services", label: "Services" },
  ...(ECOMMERCE_ENABLED ? [{ key: "shop", label: "Shop" }] : []),
]

const STATE_TABS = [
  { key: "ongoing", label: "Ongoing" },
  { key: "past", label: "Past" },
]

const STATE_STYLE = {
  ongoing: "bg-orange-50 text-[#EB590E] dark:bg-orange-500/10",
  completed: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  cancelled: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
}

const PAGE_SIZE = 20

const formatDate = (value) => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

const formatAmount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `₹${n.toFixed(n % 1 ? 2 : 0)}` : ""
}

export default function AllOrders() {
  const navigate = useNavigate()
  const [service, setService] = useState("")
  const [state, setState] = useState("ongoing")
  const [items, setItems] = useState([])
  const [nextBefore, setNextBefore] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  // Changing a chip or tab while a page is loading must not let the older
  // answer overwrite the newer list.
  const requestRef = useRef(0)

  const load = useCallback(async ({ before } = {}) => {
    const requestId = ++requestRef.current
    if (before) setLoadingMore(true)
    else {
      setLoading(true)
      setItems([])
      setNextBefore(null)
    }
    setError("")
    try {
      const params = { state, limit: PAGE_SIZE }
      if (service) params.service = service
      if (before) params.before = before
      const res = await orderAPI.getAllMyOrders(params)
      if (requestId !== requestRef.current) return
      const data = res?.data?.data || {}
      const rows = Array.isArray(data.items) ? data.items : []
      setItems((prev) => {
        if (!before) return rows
        const seen = new Set(prev.map((r) => r.key))
        return [...prev, ...rows.filter((r) => !seen.has(r.key))]
      })
      setNextBefore(data.nextBefore || null)
    } catch (err) {
      if (requestId !== requestRef.current) return
      setError(err?.response?.data?.message || "Could not load your orders. Please try again.")
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [service, state])

  useEffect(() => {
    load()
  }, [load])

  const openItem = (item) => {
    if (item?.route) navigate(item.route)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] pb-10">
      <div className="bg-white dark:bg-zinc-900 p-4 flex items-center shadow-sm sticky top-0 z-10 border-b border-gray-100 dark:border-zinc-800">
        <Link to="/user/orders" aria-label="Back to food orders">
          <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-200 cursor-pointer" />
        </Link>
        <h1 className="ml-4 text-xl font-semibold text-gray-800 dark:text-white">All orders</h1>
      </div>

      <div className="bg-white dark:bg-zinc-900 px-4 pt-3 pb-2 border-b border-gray-100 dark:border-zinc-800 space-y-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {SERVICE_CHIPS.map((chip) => (
            <button
              key={chip.key || "all"}
              type="button"
              onClick={() => setService(chip.key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                service === chip.key
                  ? "bg-[#EB590E] border-[#EB590E] text-white"
                  : "bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-200"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex">
          {STATE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setState(tab.key)}
              className={`flex-1 py-2 text-sm font-semibold border-b-2 transition-colors ${
                state === tab.key
                  ? "border-[#EB590E] text-[#EB590E]"
                  : "border-transparent text-gray-500 dark:text-gray-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#EB590E] animate-spin" />
          </div>
        ) : error && items.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-3" />
            <p className="text-gray-600 dark:text-gray-300 mb-4">{error}</p>
            <button type="button" onClick={() => load()} className="text-[#EB590E] font-medium">
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 p-8 text-center">
            <ShoppingBag className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-600 dark:text-gray-300">
              {state === "ongoing" ? "Nothing on its way right now." : "No past orders yet."}
            </p>
          </div>
        ) : (
          <>
            {items.map((item) => {
              const clickable = Boolean(item.route)
              const amount = formatAmount(item.amount)
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled={!clickable}
                  onClick={() => openItem(item)}
                  className="w-full text-left bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 p-4 flex items-start gap-3 disabled:cursor-default enabled:active:scale-[0.99] transition-transform"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {item.serviceLabel || item.service}
                      </span>
                      <span className="text-[11px] text-gray-400">#{item.number}</span>
                    </div>
                    <p className="font-semibold text-gray-900 dark:text-white truncate">{item.title}</p>
                    {item.subtitle ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{item.subtitle}</p>
                    ) : null}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATE_STYLE[item.state] || STATE_STYLE.ongoing}`}>
                        {item.statusLabel}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(item.createdAt)}</span>
                    </div>
                    {!clickable ? (
                      <p className="text-xs text-gray-400 mt-1">Details are not available in this app yet.</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {amount ? <span className="text-sm font-semibold text-gray-900 dark:text-white">{amount}</span> : null}
                    {clickable ? <ChevronRight className="w-5 h-5 text-gray-400" /> : null}
                  </div>
                </button>
              )
            })}

            {error ? <p className="text-sm text-center text-red-500">{error}</p> : null}

            {nextBefore ? (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => load({ before: nextBefore })}
                className="w-full py-3 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[#EB590E] font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loadingMore ? "Loading" : "Load more"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
