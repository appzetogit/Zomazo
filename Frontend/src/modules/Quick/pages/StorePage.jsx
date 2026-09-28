import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Clock, Star } from "lucide-react"
import { quickAPI, errorMessage } from "../api"
import { GridSkeleton, ProductGrid } from "../components/ProductCard"
import FavoriteButton from "../components/FavoriteButton"
import { cx, focusRing, isRealImage, mediaUrl } from "../helpers"

/**
 * One store: its header and its menu, section by section.
 *
 * A menu item with variants (500 g / 1 kg) is shown as one card per variant, so
 * each is added straight to the cart with the variant the order needs -- no
 * product page in between, which quick commerce does not have.
 */
function expandVariants(items = []) {
  return items.flatMap((item) => {
    const variants = Array.isArray(item.variants) ? item.variants : []
    if (!variants.length) return [item]
    return variants.map((v) => ({
      ...item,
      _id: `${item._id || item.id}:${v._id || v.id}`,
      itemId: String(item._id || item.id),
      variantId: String(v._id || v.id),
      variantName: v.name,
      name: `${item.name} · ${v.name}`,
      price: v.price,
      otherPrice: v.otherPrice,
      mrp: null,
      stockQty: v.stockQty ?? item.stockQty,
      isAvailable: item.isAvailable !== false && v.inStock !== false,
      variants: [],
    }))
  })
}

export default function StorePage() {
  const { storeId } = useParams()
  const [store, setStore] = useState(null)
  const [menu, setMenu] = useState(null)
  const [error, setError] = useState("")
  const [activeSection, setActiveSection] = useState("all")

  useEffect(() => {
    let cancelled = false
    setStore(null)
    setMenu(null)
    setError("")
    Promise.all([quickAPI.store(storeId), quickAPI.menu(storeId)])
      .then(([s, m]) => {
        if (cancelled) return
        setStore(s)
        setMenu(m)
      })
      .catch((err) => !cancelled && setError(errorMessage(err, "This store could not be opened.")))
    return () => {
      cancelled = true
    }
  }, [storeId])

  const sections = useMemo(
    () => (menu?.sections || []).filter((s) => (s.items || []).length).map((s) => ({ ...s, items: expandVariants(s.items) })),
    [menu],
  )
  const shown = activeSection === "all" ? sections.flatMap((s) => s.items) : sections.find((s) => String(s.id) === activeSection)?.items || []
  const cardStore = store ? { id: String(store._id), name: store.restaurantName } : undefined
  const eta = Number(store?.estimatedDeliveryTimeMinutes) || null
  const closed = store && (store.isOpenNow === false || store.isAcceptingOrders === false)

  if (error) return <p className="px-4 py-16 text-center text-[14px] text-wh-muted">{error}</p>

  const logo = mediaUrl(store?.profileImage)
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-3 py-3 lg:px-6">
      <section className="flex items-center gap-4 rounded-[8px] bg-wh-surface px-4 py-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-wh-brand-50">
          {isRealImage(logo) ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <span className="text-[22px] font-black text-wh-brand-ink">{String(store?.restaurantName || "").charAt(0)}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-black tracking-tight text-wh-text">{store?.restaurantName || "Loading…"}</h1>
          <p className="truncate text-[13px] text-wh-muted">{[store?.area, store?.city].filter(Boolean).join(", ")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-[12px]">
            {eta ? <span className="inline-flex items-center gap-1 font-bold text-wh-success"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{eta} min</span> : null}
            {store?.rating ? <span className="inline-flex items-center gap-1 text-wh-muted"><Star className="h-3.5 w-3.5 fill-current text-amber-500" aria-hidden="true" />{Number(store.rating).toFixed(1)}</span> : null}
            {closed ? <span className="font-bold text-wh-deal">Closed right now</span> : null}
          </p>
        </div>
        {store ? <FavoriteButton kind="store" id={store._id} name={store.restaurantName} size="h-5 w-5" className="shrink-0 border border-wh-border p-2" /> : null}
      </section>

      {sections.length > 1 ? (
        <nav aria-label="Store sections" className="sticky top-[124px] z-30 flex gap-2 overflow-x-auto bg-[#F5F5F5] py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ id: "all", name: "All" }, ...sections].map((s) => {
            const id = String(s.id)
            const active = id === activeSection
            return (
              <button key={id} type="button" onClick={() => setActiveSection(id)} aria-pressed={active}
                className={cx("shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold", active ? "border-wh-brand-ink bg-wh-brand-50 text-wh-brand-ink" : "border-wh-border bg-white text-wh-text", focusRing)}>
                {s.name}
              </button>
            )
          })}
        </nav>
      ) : null}

      <section className="rounded-[8px] bg-wh-surface px-3 py-4 sm:px-4">
        {!menu ? (
          <GridSkeleton count={8} />
        ) : shown.length ? (
          <ProductGrid products={shown} etaMinutes={eta} store={cardStore} showStore={false} />
        ) : (
          <p className="py-12 text-center text-[14px] text-wh-muted">This store has nothing listed yet.</p>
        )}
      </section>
    </div>
  )
}
