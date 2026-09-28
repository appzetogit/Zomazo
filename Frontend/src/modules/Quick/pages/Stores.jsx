import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { quickAPI } from "../api"
import { useQuickLocation } from "../context/QuickLocationContext"
import StoreCard, { storeId } from "../components/StoreCard"
import { cx, focusRing } from "../helpers"

/**
 * Every store delivering to the customer's zone, sorted by the listing API:
 * nearest (from the customer's location), best rated or fastest delivery.
 * The sort lives in the URL so back/forward and sharing keep it.
 */
const PAGE = 24
const SORTS = [
  { key: "nearest", label: "Nearest", needsLocation: true },
  { key: "rating", label: "Top rated" },
  { key: "deliveryTime", label: "Fastest delivery" },
]

export default function Stores() {
  const { zoneId, zoneStatus, location } = useQuickLocation()
  const [params, setParams] = useSearchParams()
  const canNearest = Boolean(location)
  const requested = params.get("sort")
  const sort = SORTS.some((s) => s.key === requested) && (requested !== "nearest" || canNearest) ? requested : canNearest ? "nearest" : "rating"
  const [stores, setStores] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setPage(1)
  }, [sort, zoneId])

  useEffect(() => {
    if (zoneStatus === "loading") return undefined
    if (zoneStatus === "out") {
      setStores([])
      setTotal(0)
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    quickAPI
      .storesPage({
        zoneId: zoneId || undefined,
        sortBy: sort,
        // Distance is shown on every sort when the customer's location is known.
        lat: location?.latitude,
        lng: location?.longitude,
        page,
        limit: PAGE,
      })
      .then((r) => {
        if (cancelled) return
        setTotal(r.total)
        setStores((prev) => (page === 1 ? r.restaurants : [...prev, ...r.restaurants]))
      })
      .catch(() => !cancelled && page === 1 && setStores([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [sort, zoneId, zoneStatus, location, page])

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-3 py-3 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <h1 className="text-[20px] font-black tracking-tight text-wh-text">
          All stores{!loading || page > 1 ? <span className="ml-2 text-[13px] font-semibold text-wh-muted">{total}</span> : null}
        </h1>
        <div role="radiogroup" aria-label="Sort stores" className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SORTS.map((s) => {
            const disabled = s.needsLocation && !canNearest
            const active = s.key === sort
            return (
              <button key={s.key} type="button" role="radio" aria-checked={active} disabled={disabled}
                title={disabled ? "Allow location access to sort by distance" : undefined}
                onClick={() => setParams({ sort: s.key }, { replace: true })}
                className={cx("shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40", active ? "border-wh-brand-ink bg-wh-brand-50 text-wh-brand-ink" : "border-wh-border bg-white text-wh-text", focusRing)}>
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      <section className="rounded-[8px] bg-wh-surface px-3 py-4 sm:px-4">
        {loading && page === 1 ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wh-muted" aria-label="Loading" /></div>
        ) : stores.length ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {stores.map((s) => <StoreCard key={storeId(s)} store={s} wide />)}
            </div>
            {stores.length < total ? (
              <div className="mt-5 flex justify-center">
                <button type="button" onClick={() => setPage((p) => p + 1)} disabled={loading}
                  className={cx("h-11 rounded-[10px] border border-wh-brand-ink px-6 text-[14px] font-semibold text-wh-brand-ink disabled:opacity-50", focusRing)}>
                  {loading ? "Loading…" : "Show more"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-16 text-center text-[14px] text-wh-muted">
            {zoneStatus === "out" ? "Quick delivery does not reach your location yet." : sort === "nearest" ?"No stores with a map location deliver here yet. Try another sort." : "No stores deliver here right now. Please check back soon."}
          </p>
        )}
      </section>
    </div>
  )
}
