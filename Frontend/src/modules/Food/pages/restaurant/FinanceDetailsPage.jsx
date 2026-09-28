import { useState, useEffect, useMemo } from "react"
import { useLocation } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Download, Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { restaurantAPI } from "@food/api"

/*
 * Settlement details for the current payout cycle.
 *
 * Everything on this page is read from the server. It used to render mostly
 * hard-coded zeros under borrowed headings (TDS 194H/194C/194O, "GST paid by
 * Zomato", ads), fall back to a made-up "15 - 21 Dec'25" cycle, and crash
 * outright on a missing import. It now shows:
 *
 *  - the cycle and balances from GET /finance (the same numbers as Payouts);
 *  - a per-order breakdown for the cycle from GET /reports/orders, whose
 *    payout column is the ledger's share, i.e. what is actually paid.
 *
 * Quick-commerce finance has no cycle dates, so for those sellers the page
 * covers the last 30 days and says so.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const pad = (n) => String(n).padStart(2, "0")
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The cycle's first day from the finance response's { day, month, year } meta. */
const cycleStartDate = (meta) => {
  const day = Number(meta?.day)
  const month = MONTHS.indexOf(String(meta?.month || ""))
  const year = Number(meta?.year)
  if (!day || month < 0 || !Number.isFinite(year)) return null
  const d = new Date(year < 100 ? 2000 + year : year, month, day)
  return Number.isNaN(d.getTime()) ? null : d
}

const pickRestaurant = (finance, fallback) => {
  const r = finance?.restaurant
  if (r?.name) return r
  return fallback || null
}

export default function FinanceDetailsPage() {
  const goBack = useRestaurantBackNavigation()
  const location = useLocation()
  const [finance, setFinance] = useState(location.state?.financeData || null)
  const [restaurant, setRestaurant] = useState(location.state?.restaurantData || null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState("summary")
  const [downloading, setDownloading] = useState(false)

  // Always refetch: state handed over by Payouts can be minutes old, and a
  // direct visit or refresh has none at all.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [financeRes, ownerRes] = await Promise.all([
          restaurantAPI.getFinance(),
          restaurantAPI.getRestaurantByOwner().catch(() => null),
        ])
        if (cancelled) return
        const data = financeRes?.data?.data || null
        setFinance(data)
        const owner = ownerRes?.data?.data?.restaurant || null
        setRestaurant(pickRestaurant(data, owner))
      } catch (e) {
        if (cancelled) return
        setError(e?.response?.data?.message || "Could not load your settlement details.")
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const range = useMemo(() => {
    const today = new Date()
    const start = cycleStartDate(finance?.currentCycle?.start)
    if (start) {
      const label = `${start.getDate()} ${MONTHS[start.getMonth()]} – ${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`
      return { from: ymd(start), to: ymd(today), label, isCycle: true }
    }
    const from = new Date(today)
    from.setDate(today.getDate() - 29)
    return { from: ymd(from), to: ymd(today), label: "Last 30 days", isCycle: false }
  }, [finance])

  // Keyed on the dates, not the finance object, so the refetch above does not
  // load the same report twice.
  const hasFinance = Boolean(finance)
  useEffect(() => {
    if (!hasFinance) return undefined
    let cancelled = false
    setLoading(true)
    restaurantAPI
      .getOrdersReport({ from: range.from, to: range.to })
      .then((res) => {
        if (!cancelled) setReport(res?.data?.data || null)
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message || "Could not load the orders for this cycle.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasFinance, range.from, range.to])

  const wallet = finance?.wallet || finance?.currentCycle || {}
  const totals = report?.totals || null
  const rows = Array.isArray(report?.rows) ? report.rows : []

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await restaurantAPI.downloadOrdersReport({ from: range.from, to: range.to })
      const blob = res?.data instanceof Blob ? res.data : new Blob([res?.data ?? ""], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `settlement-${range.from}-to-${range.to}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast.error("Could not download the settlement report. Please try again.")
    } finally {
      setDownloading(false)
    }
  }

  const summaryLines = totals
    ? [
        { label: "Orders placed", value: totals.orders, money: false },
        { label: "Delivered orders", value: totals.deliveredOrders, money: false },
        { label: "Cancelled / rejected", value: totals.cancelledOrders, money: false },
        { label: "Sales (items + packaging, delivered)", value: totals.sales },
        { label: "GST collected from customers", value: totals.tax, note: "Passed to the government, not part of your payout" },
        { label: "Coupon discounts on your orders", value: totals.discount, note: "Only coupons you created reduce your payout" },
        { label: "Platform commission", value: -totals.commission },
      ]
    : []

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="sticky bg-white top-0 z-40 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <button onClick={goBack} className="p-1 rounded-full hover:bg-gray-100" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{restaurant?.name || "Settlement details"}</h1>
            {restaurant && (
              <p className="text-xs text-gray-600 mt-0.5 truncate">
                ID: {restaurant.restaurantId || "—"}
                {restaurant.address ? ` • ${restaurant.address}` : ""}
              </p>
            )}
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading || !finance}
            className="p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            aria-label="Download settlement as CSV"
            title="Download CSV"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin text-gray-700" /> : <Download className="w-4 h-4 text-gray-700" />}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-3xl mx-auto w-full flex gap-2 px-4 pt-4">
        {[
          { id: "summary", label: "Summary" },
          { id: "orders", label: `Orders${totals ? ` (${totals.orders})` : ""}` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 rounded-full text-sm font-medium ${activeTab === tab.id ? "bg-black text-white" : "bg-white text-black"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 space-y-4">
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-xs font-semibold text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {activeTab === "summary" && (
              <>
                {/* Balances */}
                <div className="bg-white rounded-lg p-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Available to withdraw</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {inr(wallet.netAvailable ?? wallet.withdrawableBalance ?? wallet.estimatedPayout)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">{range.isCycle ? "Current cycle" : "Period shown"}</p>
                    <p className="text-sm font-semibold text-gray-900">{range.label}</p>
                    <p className="text-xs text-gray-600 mt-1">Withdrawn so far: {inr(wallet.totalWithdrawn)}</p>
                  </div>
                </div>

                {/* Settlement summary */}
                <div className="bg-white rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h2 className="text-base font-bold text-gray-900">Settlement summary</h2>
                  </div>
                  {loading ? (
                    <div className="py-8 text-center text-xs text-gray-400 font-semibold animate-pulse">Loading…</div>
                  ) : totals ? (
                    <>
                      {summaryLines.map((line) => (
                        <div key={line.label} className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm text-gray-800">{line.label}</p>
                            {line.note && <p className="text-[11px] text-gray-500 mt-0.5">{line.note}</p>}
                          </div>
                          <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                            {line.money === false ? line.value : inr(line.value)}
                          </span>
                        </div>
                      ))}
                      <div className="px-4 py-3 border-t-2 border-gray-900 bg-gray-50 flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-900">Your payout for this period</span>
                        <span className="text-sm font-bold text-gray-900">{inr(totals.payout)}</span>
                      </div>
                      <p className="px-4 py-3 text-[11px] text-gray-500">
                        Payout is your share of each order as recorded in the payment ledger, counted once the
                        order's payment is captured.
                      </p>
                    </>
                  ) : (
                    <p className="px-4 py-6 text-sm text-gray-500 text-center">No settlement data for this period.</p>
                  )}
                </div>
              </>
            )}

            {activeTab === "orders" && (
              <div className="bg-white rounded-lg overflow-hidden">
                {loading ? (
                  <div className="py-8 text-center text-xs text-gray-400 font-semibold animate-pulse">Loading…</div>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No orders in this period.</p>
                ) : (
                  [...rows].reverse().map((row) => (
                    <div key={row.orderId} className="px-4 py-3 border-b border-gray-100">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-gray-900">#{row.orderId}</span>
                        <span className="text-sm font-bold text-gray-900">{inr(row.payout)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-0.5">
                        <span className="text-xs text-gray-500 truncate">
                          {new Date(row.placedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {" · "}
                          {String(row.status).replace(/_/g, " ")}
                        </span>
                        <span className="text-[11px] text-gray-500 whitespace-nowrap">{row.payoutStatus}</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1 truncate">{row.items}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Subtotal {inr(row.subtotal)} · Commission {inr(row.commission)} · Customer paid {inr(row.customerTotal)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
