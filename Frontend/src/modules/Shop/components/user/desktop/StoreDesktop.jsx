/**
 * Desktop (lg+) store page: store header (cover, logo, rating, delivery info)
 * and the store's products in the listing grid, with a category rail built
 * from the store's own menu sections. Data comes from SellerDetails (already
 * fetched); this component only lays it out.
 */
import { useMemo, useState } from "react"
import { Star, Clock, MapPin } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { ListingTile, SORT_OPTIONS, TileGrid, mediaUrl } from "./ListingDesktop"

const cx = (...a) => a.filter(Boolean).join(" ")
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand"
const priceOf = (p) => Number(p.displayPrice ?? p.price) || 0

/**
 * Props: seller, sections ([{ id, name, items, subsections }]), coverImage,
 * isOpen, onAddToCart(item).
 */
export default function StoreDesktop({ seller, sections = [], coverImage, isOpen = true, onAddToCart }) {
  const { isQuick } = useStoreMode()
  const channel = isQuick ? "quick" : "shop"
  const [activeId, setActiveId] = useState("all")
  const [sort, setSort] = useState("relevance")

  const groups = useMemo(() => {
    return (Array.isArray(sections) ? sections : [])
      .map((s) => {
        const seen = new Set()
        const items = [...(s.items || []), ...(s.subsections || []).flatMap((sub) => sub.items || [])]
          .filter((it) => {
            const key = String(it.id || it._id)
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        return { id: s.id, name: s.name, items }
      })
      .filter((g) => g.items.length > 0)
  }, [sections])

  const items = useMemo(() => {
    const list = activeId === "all"
      ? groups.flatMap((g) => g.items).filter((it, i, arr) => arr.findIndex((x) => String(x.id) === String(it.id)) === i)
      : groups.find((g) => g.id === activeId)?.items || []
    const rows = [...list]
    if (sort === "price_asc") rows.sort((a, b) => priceOf(a) - priceOf(b))
    else if (sort === "price_desc") rows.sort((a, b) => priceOf(b) - priceOf(a))
    else if (sort === "rating") rows.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
    return rows
  }, [groups, activeId, sort])

  const logo = mediaUrl(seller?.profileImageUrl?.url || seller?.profileImage || seller?.image)
  const cover = mediaUrl(coverImage)
  const rating = Number(seller?.rating) || 0
  const ratingCount = Number(seller?.totalRatings || seller?.ratingCount || seller?.reviewCount) || 0
  const eta = seller?.estimatedDeliveryTimeMinutes
    ? `${seller.estimatedDeliveryTimeMinutes} min`
    : seller?.deliveryTime || seller?.estimatedDeliveryTime || ""
  const location = typeof seller?.location === "string" ? seller.location : ""
  const distance = typeof seller?.distance === "number" ? `${seller.distance.toFixed(1)} km` : seller?.distance || ""
  const sortOptions = SORT_OPTIONS.filter((o) => o.value !== "newest")

  return (
    <div className="min-h-screen bg-wh-surface text-wh-text">
      <header className="mx-auto max-w-[1500px] px-5 pt-4">
        <div className="relative h-48 overflow-hidden rounded-[8px] bg-wh-nav-2">
          {cover ? <img src={cover} alt={`${seller?.name || "Store"} cover`} className="h-full w-full object-cover" /> : null}
        </div>
        <div className="-mt-10 flex items-end gap-5 px-6">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border-4 border-wh-surface bg-wh-surface shadow">
            {logo ? (
              <img src={logo} alt={`${seller?.name || "Store"} logo`} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[32px] font-bold text-wh-muted" aria-hidden="true">{(seller?.name || "S").charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate text-[24px] font-bold leading-8">{seller?.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-wh-muted">
              {rating > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4 fill-wh-brand text-wh-brand" aria-hidden="true" />
                  <span className="text-wh-text">{rating.toFixed(1)}</span>
                  {ratingCount ? <span>({ratingCount} ratings)</span> : null}
                </span>
              ) : null}
              {isQuick && eta ? (
                <span className="inline-flex items-center gap-1 font-medium text-wh-success">
                  <Clock className="h-4 w-4" aria-hidden="true" /> Delivers in {eta}
                </span>
              ) : !isQuick ? (
                <span className="inline-flex items-center gap-1 font-medium text-wh-success">
                  <Clock className="h-4 w-4" aria-hidden="true" /> Ships in 2–4 days
                </span>
              ) : null}
              {location || distance ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" aria-hidden="true" /> {[location, distance].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-bold", isOpen ? "bg-[#E6F4EA] text-wh-success" : "bg-[#FDECEF] text-wh-deal")}>
                {isOpen ? "Open now" : "Closed"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px] gap-6 px-5 py-6">
        <aside className="w-[240px] shrink-0" aria-label="Store categories">
          <h2 className="mb-2 text-[14px] font-bold">Category</h2>
          <ul className="space-y-0.5">
            {[{ id: "all", name: "All products", items: groups.flatMap((g) => g.items) }, ...groups].map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(g.id)}
                  aria-current={activeId === g.id ? "true" : undefined}
                  className={cx("flex w-full items-center justify-between gap-2 rounded-[4px] py-0.5 text-left text-[14px] hover:text-wh-link-hover", activeId === g.id ? "font-bold" : "", focusRing)}
                >
                  <span className="truncate">{g.name}</span>
                  {g.id !== "all" ? <span className="text-[12px] text-wh-muted">{g.items.length}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4 border-b border-wh-border pb-3">
            <p className="text-[14px]" aria-live="polite">
              {items.length ? `1-${items.length} of ${items.length} results` : "No products"}
              {activeId !== "all" ? <> in <span className="font-bold">{groups.find((g) => g.id === activeId)?.name}</span></> : null}
            </p>
            <label className="flex items-center gap-2 text-[13px] text-wh-muted">
              Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={cx("h-8 rounded-[8px] border border-wh-border bg-[#F0F2F2] px-2 text-[13px] text-wh-text", focusRing)}>
                {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4">
            {items.length ? (
              <TileGrid>
                {items.map((item) => (
                  <ListingTile
                    key={item.id}
                    product={item}
                    channel={channel}
                    etaMinutes={seller?.estimatedDeliveryTimeMinutes}
                    onAddToCart={isOpen ? onAddToCart : undefined}
                  />
                ))}
              </TileGrid>
            ) : (
              <p className="py-16 text-center text-[14px] text-wh-muted">This store has no products to show here yet.</p>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
