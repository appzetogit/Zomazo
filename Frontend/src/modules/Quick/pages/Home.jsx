import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { MapPinOff, Star } from "lucide-react"
import { quickAPI } from "../api"
import { useQuickLocation } from "../context/QuickLocationContext"
import CategoryTiles from "../components/CategoryTiles"
import { ProductRail } from "../components/ProductCard"
import { cx, focusRing, isRealImage, mediaUrl } from "../helpers"

/**
 * Quick home: what can reach the customer in minutes, from the stores serving
 * their zone. Categories first, then what is popular, then a rail per top
 * category (the Shop's Quick home layout, fed by the quick-commerce API).
 */
const RAIL_CATEGORIES = 4

function StoreCard({ store }) {
  const id = String(store._id || store.id)
  const img = mediaUrl(store.profileImage?.url || store.profileImage || store.coverImages?.[0])
  const eta = Number(store.estimatedDeliveryTimeMinutes) || null
  return (
    <Link to={`/quick/store/${id}`} className={cx("flex w-[220px] shrink-0 items-center gap-3 rounded-[10px] border border-wh-border bg-white p-3 hover:shadow-md", focusRing)}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-wh-brand-50">
        {isRealImage(img) ? <img src={img} alt="" className="h-full w-full object-cover" /> : <span className="font-black text-wh-brand-ink">{String(store.restaurantName || store.name || "?").charAt(0)}</span>}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold text-wh-text">{store.restaurantName || store.name}</span>
        <span className="flex items-center gap-2 text-[12px] text-wh-muted">
          {store.rating ? <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3 fill-current text-amber-500" aria-hidden="true" />{Number(store.rating).toFixed(1)}</span> : null}
          {eta ? <span>{eta} min</span> : null}
          {store.isOpenNow === false || store.isAcceptingOrders === false ? <span className="text-wh-deal">Closed</span> : null}
        </span>
      </span>
    </Link>
  )
}

function Banners({ banners }) {
  if (!banners.length) return null
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Offers">
      {banners.slice(0, 8).map((b) => {
        const img = mediaUrl(b.imageUrl)
        if (!isRealImage(img)) return null
        return (
          <div key={b._id} className="aspect-[16/7] w-[85%] shrink-0 overflow-hidden rounded-[12px] bg-wh-brand-50 sm:w-[48%] lg:w-[32%]">
            <img src={img} alt={b.title || "Offer"} className="h-full w-full object-cover" />
          </div>
        )
      })}
    </div>
  )
}

export default function Home() {
  const { zoneId, zoneStatus, areaLabel, requestLocation } = useQuickLocation()
  const [categories, setCategories] = useState([])
  const [popular, setPopular] = useState([])
  const [byCategory, setByCategory] = useState({})
  const [stores, setStores] = useState([])
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    quickAPI.heroBanners().then(setBanners).catch(() => {})
  }, [])

  useEffect(() => {
    if (zoneStatus === "loading" || zoneStatus === "out") {
      setLoading(zoneStatus === "loading")
      return undefined
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      quickAPI.categories(zoneId).catch(() => []),
      quickAPI.products({ zoneId, limit: 30 }).catch(() => ({ products: [] })),
      quickAPI.stores({ zoneId, limit: 20 }).catch(() => []),
    ]).then(async ([cats, pop, near]) => {
      if (cancelled) return
      setCategories(cats)
      setPopular(pop.products || [])
      setStores(near)
      setLoading(false)
      const top = cats.slice(0, RAIL_CATEGORIES)
      const rails = await Promise.all(
        top.map((c) => quickAPI.products({ zoneId, categoryId: String(c._id || c.id), limit: 16 }).then((r) => [String(c._id || c.id), r.products || []]).catch(() => [String(c._id || c.id), []])),
      )
      if (!cancelled) setByCategory(Object.fromEntries(rails))
    })
    return () => {
      cancelled = true
    }
  }, [zoneId, zoneStatus])

  const deals = useMemo(
    () => popular.filter((p) => Number(p.mrp || p.otherPrice) > Number(p.price)).slice(0, 16),
    [popular],
  )

  if (zoneStatus === "out") {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-16 text-center">
        <MapPinOff className="mx-auto h-10 w-10 text-wh-brand-ink" aria-hidden="true" />
        <h1 className="mt-4 text-[20px] font-black text-wh-text">We don&apos;t deliver to {areaLabel || "this area"} yet</h1>
        <p className="mt-2 text-[14px] text-wh-muted">Quick delivery reaches a growing list of neighbourhoods. Try another location, or order from the Shop, which ships everywhere.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={requestLocation} className={cx("h-11 rounded-[10px] bg-wh-brand-ink px-5 text-[14px] font-bold text-white", focusRing)}>Use my current location</button>
          <Link to="/shop" className={cx("inline-flex h-11 items-center rounded-[10px] border border-wh-border px-5 text-[14px] font-semibold", focusRing)}>Go to the Shop</Link>
        </div>
      </div>
    )
  }

  const nothing = !loading && !popular.length && !categories.length
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-3 py-3 lg:px-6">
      <Banners banners={banners} />
      <CategoryTiles categories={categories.slice(0, 16)} loading={loading} />
      {stores.length ? (
        <section className="rounded-[8px] bg-wh-surface px-4 py-4 lg:px-5">
          <h2 className="mb-3 text-[19px] font-black leading-6 tracking-tight lg:font-bold">Stores near you</h2>
          <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {stores.map((s) => <StoreCard key={String(s._id || s.id)} store={s} />)}
          </div>
        </section>
      ) : null}
      <ProductRail title="Deals of the day" products={deals} loading={loading} />
      <ProductRail title="Popular right now" products={popular} loading={loading} min={1} />
      {categories.slice(0, RAIL_CATEGORIES).map((c) => {
        const id = String(c._id || c.id)
        return <ProductRail key={id} title={c.name} products={byCategory[id] || []} seeAllTo={`/quick/category/${id}`} />
      })}
      {nothing ? (
        <p className="py-16 text-center text-[14px] text-wh-muted">No stores are open for quick delivery here right now. Please check back soon.</p>
      ) : null}
    </div>
  )
}
