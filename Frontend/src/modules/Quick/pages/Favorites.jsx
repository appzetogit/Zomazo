import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Heart, Loader2 } from "lucide-react"
import { quickAPI } from "../api"
import { useQuickFavorites } from "../context/QuickFavoritesContext"
import { ProductGrid } from "../components/ProductCard"
import StoreCard, { storeId } from "../components/StoreCard"
import { cx, focusRing, isSignedIn } from "../helpers"

/**
 * The customer's saved products and stores. Unfavouriting here keeps the item
 * on screen (its heart empties) until the page is next opened, so a slip of
 * the finger can be undone with a second tap.
 */
export default function Favorites() {
  const { version } = useQuickFavorites()
  const [tab, setTab] = useState("product")
  const [data, setData] = useState(null)
  const signedIn = isSignedIn()

  useEffect(() => {
    if (!signedIn) return undefined
    let cancelled = false
    quickAPI
      .favorites()
      .then((d) => {
        if (cancelled) return
        // Merge rather than replace, so an entry just un-hearted stays visible.
        setData((prev) => {
          const keep = (list = [], more = []) => {
            const seen = new Set(more.map((x) => String(x._id)))
            return [...more, ...list.filter((x) => !seen.has(String(x._id)))]
          }
          return prev ? { foods: keep(prev.foods, d.foods), restaurants: keep(prev.restaurants, d.restaurants) } : { foods: d.foods || [], restaurants: d.restaurants || [] }
        })
      })
      .catch(() => !cancelled && setData((prev) => prev || { foods: [], restaurants: [] }))
    return () => {
      cancelled = true
    }
  }, [signedIn, version])

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-20 text-center">
        <Heart className="mx-auto h-10 w-10 text-wh-brand-ink" aria-hidden="true" />
        <h1 className="mt-4 text-[20px] font-black text-wh-text">Sign in to see your favourites</h1>
        <Link to="/login" state={{ from: { pathname: "/quick/favorites" } }} className={cx("mt-6 inline-flex h-11 items-center rounded-[10px] bg-wh-brand-ink px-6 text-[14px] font-bold text-white", focusRing)}>Sign in</Link>
      </div>
    )
  }

  const products = data?.foods || []
  const stores = data?.restaurants || []
  const tabs = [
    { key: "product", label: "Products", count: products.length },
    { key: "store", label: "Stores", count: stores.length },
  ]

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-3 py-3 lg:px-6">
      <h1 className="px-1 text-[20px] font-black tracking-tight text-wh-text">Your favourites</h1>
      <div role="tablist" aria-label="Favourites" className="flex gap-2 px-1">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cx("rounded-full border px-4 py-1.5 text-[13px] font-semibold", tab === t.key ? "border-wh-brand-ink bg-wh-brand-50 text-wh-brand-ink" : "border-wh-border bg-white text-wh-text", focusRing)}>
            {t.label}{data ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>
      <section className="rounded-[8px] bg-wh-surface px-3 py-4 sm:px-4" role="tabpanel">
        {data === null ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wh-muted" aria-label="Loading" /></div>
        ) : tab === "product" ? (
          products.length ? (
            <ProductGrid products={products} />
          ) : (
            <p className="py-16 text-center text-[14px] text-wh-muted">Tap the heart on any product to keep it here. <Link to="/quick" className="font-semibold text-wh-link">Browse products</Link></p>
          )
        ) : stores.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((s) => <StoreCard key={storeId(s)} store={s} wide />)}
          </div>
        ) : (
          <p className="py-16 text-center text-[14px] text-wh-muted">Tap the heart on a store to keep it here. <Link to="/quick/stores" className="font-semibold text-wh-link">See all stores</Link></p>
        )}
      </section>
    </div>
  )
}
