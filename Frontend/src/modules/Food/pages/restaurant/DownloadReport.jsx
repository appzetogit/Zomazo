import { useState, useMemo, useEffect } from "react"
import { ArrowLeft, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { restaurantAPI } from "@food/api"

/*
 * Orders and earnings for a date range, downloaded as a spreadsheet (CSV).
 *
 * This page used to only show a "Report Queued -- we will email it" toast;
 * nothing was generated or sent. It now previews the totals for the chosen
 * range and downloads the report from GET /reports/orders, the same data on
 * the food and quick-commerce backends.
 */

const pad = (n) => String(n).padStart(2, "0")
/** A local calendar date as YYYY-MM-DD; the server reads it as that day in IST. */
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

const PRESETS = [
  { id: "7", label: "Last 7 days", range: () => ({ from: ymd(daysAgo(6)), to: ymd(new Date()) }) },
  { id: "30", label: "Last 30 days", range: () => ({ from: ymd(daysAgo(29)), to: ymd(new Date()) }) },
  { id: "90", label: "Last 90 days", range: () => ({ from: ymd(daysAgo(89)), to: ymd(new Date()) }) },
  {
    id: "this-month",
    label: "This month",
    range: () => {
      const now = new Date()
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }
    },
  },
  {
    id: "last-month",
    label: "Last month",
    range: () => {
      const now = new Date()
      return {
        from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
  { id: "custom", label: "Custom range", range: null },
]

const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

/** The server's reason, including when the error body arrived as a Blob. */
const errorMessage = async (error, fallback) => {
  const data = error?.response?.data
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text())?.message || fallback
    } catch {
      return fallback
    }
  }
  return data?.message || fallback
}

export default function DownloadReport() {
  const goBack = useRestaurantBackNavigation()
  const [preset, setPreset] = useState("7")
  const [custom, setCustom] = useState(() => ({ from: ymd(daysAgo(6)), to: ymd(new Date()) }))
  const [summary, setSummary] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const range = useMemo(() => {
    const chosen = PRESETS.find((p) => p.id === preset)
    return chosen?.range ? chosen.range() : custom
  }, [preset, custom])

  const rangeValid = Boolean(range.from && range.to && range.from <= range.to)

  // Totals for the chosen range, so the seller sees what they are about to
  // download (and that there is anything in it) before saving a file.
  useEffect(() => {
    if (!rangeValid) {
      setSummary(null)
      return
    }
    let cancelled = false
    setLoadingSummary(true)
    restaurantAPI
      .getOrdersReport(range)
      .then((res) => {
        if (!cancelled) setSummary(res?.data?.data || null)
      })
      .catch(async (error) => {
        if (cancelled) return
        setSummary(null)
        toast.error(await errorMessage(error, "Could not load the report."))
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false)
      })
    return () => {
      cancelled = true
    }
  }, [range.from, range.to, rangeValid])

  const handleDownload = async () => {
    if (!rangeValid || downloading) return
    setDownloading(true)
    try {
      const res = await restaurantAPI.downloadOrdersReport(range)
      const blob = res?.data instanceof Blob ? res.data : new Blob([res?.data ?? ""], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `orders-report-${range.from}-to-${range.to}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success("Report downloaded")
    } catch (error) {
      toast.error(await errorMessage(error, "Could not download the report. Please try again."))
    } finally {
      setDownloading(false)
    }
  }

  const totals = summary?.totals

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
              onClick={goBack}
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">Download Reports</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Your orders and earnings as a spreadsheet (CSV)</p>
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={!rangeValid || downloading}
            className="hidden sm:inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-black disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>Download CSV</span>
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        {/* 1. Duration */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">1. Select date range</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
            {PRESETS.map((opt) => {
              const isSelected = preset === opt.id
              return (
                <label
                  key={opt.id}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSelected ? "bg-gray-50 border-gray-900 shadow-sm ring-1 ring-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="duration"
                    value={opt.id}
                    checked={isSelected}
                    onChange={() => setPreset(opt.id)}
                    className="w-4 h-4 accent-black"
                  />
                  <span className="text-xs font-bold text-gray-900">{opt.label}</span>
                </label>
              )
            })}
          </div>
          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="text-xs font-semibold text-gray-600 space-y-1">
                <span>From</span>
                <input
                  type="date"
                  value={custom.from}
                  max={custom.to || ymd(new Date())}
                  onChange={(e) => setCustom((prev) => ({ ...prev, from: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </label>
              <label className="text-xs font-semibold text-gray-600 space-y-1">
                <span>To</span>
                <input
                  type="date"
                  value={custom.to}
                  min={custom.from}
                  max={ymd(new Date())}
                  onChange={(e) => setCustom((prev) => ({ ...prev, to: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </label>
              {!rangeValid && (
                <p className="col-span-2 text-xs font-semibold text-red-600">Choose a start date on or before the end date.</p>
              )}
            </div>
          )}
        </div>

        {/* 2. Preview */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">2. What the report contains</h2>
          <p className="text-xs text-gray-500">
            One row per order: status, payment, items, subtotal, packaging, discount, tax, commission and your payout.
            Payout is counted once the order's payment is captured, the same as on your Payouts page.
          </p>
          {loadingSummary ? (
            <div className="py-6 text-center text-xs text-gray-400 font-semibold animate-pulse">Loading…</div>
          ) : totals ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Orders", value: totals.orders },
                  { label: "Delivered", value: totals.deliveredOrders },
                  { label: "Sales", value: inr(totals.sales) },
                  { label: "Your payout", value: inr(totals.payout) },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <p className="text-[11px] font-semibold text-gray-500">{tile.label}</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">{tile.value}</p>
                  </div>
                ))}
              </div>
              {totals.orders === 0 && (
                <p className="text-xs font-semibold text-amber-700">No orders in this range. The file will contain only the column headings.</p>
              )}
              {summary?.truncated && (
                <p className="text-xs font-semibold text-amber-700">This range has more orders than one file holds; choose a shorter range to get them all.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400">Choose a valid date range to see a preview.</p>
          )}
        </div>

        {/* Mobile Submit Button */}
        <div className="sm:hidden pt-2">
          <button
            onClick={handleDownload}
            disabled={!rangeValid || downloading}
            className="w-full bg-gray-900 hover:bg-black disabled:opacity-50 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-all"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>Download CSV</span>
          </button>
        </div>
      </div>
    </div>
  )
}
