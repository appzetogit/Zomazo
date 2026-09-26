/**
 * Desktop (lg+) listing pieces (DESKTOP_THEME.md, "Listing pages"): a 240px
 * filter rail, a results bar with count and sort, and a 4–5 column grid of
 * product tiles with the channel-aware stock / delivery line.
 *
 * Data: GET /catalog/search/products (searchAPI.searchProducts) with the
 * params it already accepts (q, smart, smartExclude, categoryId, brand,
 * attr[...], minPrice, maxPrice, inStockOnly, sort, page, limit, facets).
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { adminAPI } from "@store/api"
import { searchAPI } from "@/services/api"
import { channelAvailability, stockLabel } from "@store/utils/channelStock"
import { ImagePlaceholder, isRealImage, DealBadge, DeliveryPromise, PriceTag, percentOff } from "./ui"
import { mediaUrl, useDesktopAddToCart } from "./desktopCart"
import { QuickGridSkeleton, QuickProductGrid } from "./quick/QuickRail"
import QuickSubcategoryRail from "./quick/QuickSubcategoryRail"

const cx = (...a) => a.filter(Boolean).join(" ")
const PAGE_SIZE = 24
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand"

// Re-exported so existing importers (StoreDesktop) keep working.
export { mediaUrl, useDesktopAddToCart }

export const SORT_OPTIONS = [
  { value: "relevance", label: "Featured" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Customer rating" },
  { value: "newest", label: "Newest arrivals" },
]

const firstImage = (p) => mediaUrl(p?.imageUrl || p?.image || (Array.isArray(p?.images) ? p.images[0] : ""))
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

/** Green delivery promise when in stock, otherwise the stock label; "Only N left" when low. */
export function StockDeliveryLine({ product, channel, etaMinutes }) {
  const availability = channelAvailability(product, channel)
  if (!availability.inStock) {
    return <p className="text-[13px] font-medium text-wh-deal">{stockLabel(availability)}</p>
  }
  return (
    <div>
      {channel === "quick" ? (
        <DeliveryPromise mode="quick" etaMinutes={etaMinutes} />
      ) : (
        <DeliveryPromise mode="shop" />
      )}
      {availability.low ? <p className="text-[12px] text-wh-deal">{stockLabel(availability)}</p> : null}
    </div>
  )
}

/** Result tile: image, 2-line title, rating, price/MRP/% off, stock-delivery line, Add to cart pill. */
export function ListingTile({ product, channel, etaMinutes, onAddToCart }) {
  const { storePath } = useStoreMode()
  const id = product._id || product.id
  const to = storePath(`/product/${id}`)
  const price = product.displayPrice ?? product.price
  const mrp = product.mrp ?? product.originalPrice
  const off = percentOff(price, mrp)
  const img = firstImage(product)
  const rating = num(product.rating ?? product.averageRating)
  const inStock = channelAvailability(product, channel).inStock
  const hasOptions = Array.isArray(product.variants) && product.variants.length > 0
  // The card's proportions follow MOBILE_UI_SPEC.md: a 4:5 cover image flush to
  // the card's top, then a compact body and a full-width outlined action.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-wh-border bg-wh-surface text-wh-text">
      <Link to={to} className={cx("block", focusRing)}>
        <div className="aspect-[4/5] w-full overflow-hidden rounded-t-2xl bg-[#F7F7F7]">
          {isRealImage(img) ? (
            <img
              src={img}
              alt={product.name || "Product"}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 ease-out hover:scale-105"
            />
          ) : (
            <ImagePlaceholder name={product.name} />
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-2 sm:p-2.5">
        <Link to={to} className={cx("line-clamp-2 text-[12px] font-semibold uppercase leading-snug tracking-tight hover:text-wh-link-hover sm:text-[13px]", focusRing)}>
          {product.name}
        </Link>
        {product.packSize ? <span className="text-[11px] text-wh-muted">{product.packSize}</span> : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {hasOptions ? <span className="text-[11px] text-wh-muted">From</span> : null}
          <PriceTag price={price} mrp={mrp} />
          {off ? <DealBadge percent={off} /> : null}
        </div>
        {rating ? (
          <span className="text-[11px] text-wh-muted" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
            <span className="text-wh-brand" aria-hidden="true">{"★".repeat(Math.round(rating))}</span> {rating.toFixed(1)}
          </span>
        ) : null}
        <StockDeliveryLine product={product} channel={channel} etaMinutes={etaMinutes} />
        {onAddToCart ? (
          <div className="mt-auto pt-2">
            <button
              type="button"
              disabled={!inStock}
              onClick={() => onAddToCart(product)}
              className={cx(
                "w-full rounded-full border-[0.8px] border-wh-text px-3 py-1.5 text-[12px] font-medium text-wh-text transition-colors hover:border-wh-brand hover:bg-wh-brand disabled:cursor-not-allowed disabled:opacity-50",
                focusRing,
              )}
            >
              {hasOptions ? "See options" : "Add to cart"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function TileGrid({ children }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">{children}</div>
  )
}

function RailSection({ title, children }) {
  return (
    <section className="border-b border-wh-border py-3 last:border-b-0">
      <h3 className="mb-2 text-[14px] font-bold text-wh-text">{title}</h3>
      {children}
    </section>
  )
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[14px] text-wh-text">
      <input type="checkbox" checked={checked} onChange={onChange} className={cx("h-4 w-4 accent-[var(--wh-brand)]", focusRing)} />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  )
}

/** Category tree built from the public categories (parentId groups subcategories). */
export function buildCategoryTree(list = []) {
  const rows = (Array.isArray(list) ? list : []).map((c, i) => ({
    id: String(c._id || c.id || ""),
    slug: c.slug || String(c.name || "").toLowerCase().replace(/\s+/g, "-"),
    name: c.name || "",
    image: c.image || c.imageUrl || "",
    parentId: c.parentId ? String(c.parentId?._id || c.parentId) : null,
    sortOrder: Number(c.sortOrder) || 0,
    order: i,
  })).filter((c) => c.id && c.name)
    // The API appends product-less parents after the listed categories; restore sortOrder.
    .sort((a, b) => a.sortOrder - b.sortOrder || a.order - b.order)
  const ids = new Set(rows.map((r) => r.id))
  const top = rows.filter((r) => !r.parentId || !ids.has(r.parentId))
  return top.map((t) => ({ ...t, children: rows.filter((r) => r.parentId === t.id) }))
}

function CategoryTree({ tree, selectedId, onSelect }) {
  const selectedTop = tree.find((t) => t.id === selectedId || t.children.some((c) => c.id === selectedId))
  const link = (cat, level = 0) => {
    const active = cat.id === selectedId
    return (
      <li key={cat.id}>
        <button
          type="button"
          onClick={() => onSelect(cat)}
          className={cx(
            "w-full truncate rounded-[4px] py-0.5 text-left text-[14px] hover:text-wh-link-hover",
            level ? "pl-3" : "",
            active ? "font-bold text-wh-text" : "text-wh-text",
            focusRing,
          )}
          aria-current={active ? "true" : undefined}
        >
          {cat.name}
        </button>
      </li>
    )
  }
  return (
    <ul className="max-h-80 space-y-0.5 overflow-y-auto pr-1">
      {selectedId ? (
        <li>
          <button type="button" onClick={() => onSelect(null)} className={cx("flex items-center gap-1 py-0.5 text-[14px] text-wh-link hover:text-wh-link-hover", focusRing)}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Any category
          </button>
        </li>
      ) : null}
      {tree.map((top) => (
        <li key={top.id}>
          <ul>
            {link(top)}
            {selectedTop?.id === top.id ? top.children.map((c) => link(c, 1)) : null}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function PriceFilter({ range, minPrice, maxPrice, onApply }) {
  const [min, setMin] = useState(minPrice ?? "")
  const [max, setMax] = useState(maxPrice ?? "")
  useEffect(() => { setMin(minPrice ?? ""); setMax(maxPrice ?? "") }, [minPrice, maxPrice])
  const input = cx("h-8 w-20 rounded-[8px] border border-wh-border px-2 text-[13px] text-wh-text", focusRing)
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onApply(num(min), num(max))
      }}
    >
      <input aria-label="Minimum price" inputMode="numeric" placeholder={range?.min != null ? `₹${Math.floor(range.min)}` : "Min"} value={min} onChange={(e) => setMin(e.target.value)} className={input} />
      <span className="text-wh-muted">–</span>
      <input aria-label="Maximum price" inputMode="numeric" placeholder={range?.max != null ? `₹${Math.ceil(range.max)}` : "Max"} value={max} onChange={(e) => setMax(e.target.value)} className={input} />
      <button type="submit" className={cx("h-8 rounded-[8px] border border-wh-border bg-wh-surface px-3 text-[13px] hover:bg-[#F7FAFA]", focusRing)}>Go</button>
    </form>
  )
}

const EMPTY_FILTERS = { brands: [], attrs: {}, minPrice: null, maxPrice: null, inStockOnly: false }

/**
 * The full desktop listing: rail + results bar + grid + pages.
 * Props: q, smart (bool, search chips), categoryId (Mongo id) or categorySlug,
 * onSelectCategory(cat|null), zoneId, title, emptyText.
 */
export function DesktopProductListing({ q = "", smart = false, categoryId = null, categorySlug = null, onSelectCategory, zoneId, title, minDiscount = null }) {
  const { isQuick, fulfilmentMode } = useStoreMode()
  const channel = isQuick ? "quick" : "shop"
  const addToCart = useDesktopAddToCart()
  const [rawCategories, setRawCategories] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState("relevance")
  const [page, setPage] = useState(1)
  const [removedChips, setRemovedChips] = useState([])
  const [state, setState] = useState({ loading: true, products: [], total: 0, facets: null, chips: [] })

  useEffect(() => {
    let cancelled = false
    adminAPI.getPublicCategories(zoneId ? { zoneId } : {})
      .then((res) => {
        const list = res?.data?.data?.categories || res?.data?.categories || []
        if (!cancelled) setRawCategories(Array.isArray(list) ? list : [])
      })
      .catch(() => { if (!cancelled) setRawCategories([]) })
    return () => { cancelled = true }
  }, [zoneId])

  const tree = useMemo(() => buildCategoryTree(rawCategories), [rawCategories])
  const allCats = useMemo(() => tree.flatMap((t) => [t, ...t.children]), [tree])
  const selectedCat = useMemo(
    () => allCats.find((c) => (categoryId && c.id === String(categoryId)) || (categorySlug && (c.slug.toLowerCase() === String(categorySlug).toLowerCase() || c.id === String(categorySlug)))) || null,
    [allCats, categoryId, categorySlug],
  )
  const effectiveCategoryId = categoryId || selectedCat?.id || null
  // A slug that isn't resolved yet: wait for the categories rather than listing everything.
  const waitingForCategory = !categoryId && categorySlug && categorySlug !== "all" && !selectedCat && rawCategories.length === 0

  // A new query or category starts clean.
  useEffect(() => {
    setFilters(EMPTY_FILTERS)
    // Keep the same array when nothing was removed, or the search re-runs for nothing.
    setRemovedChips((c) => (c.length ? [] : c))
    setPage(1)
  }, [q, effectiveCategoryId])

  useEffect(() => {
    if (waitingForCategory) return undefined
    // A discount page ("Minimum 35% off") lists across every category.
    if (!q && !effectiveCategoryId && !(categorySlug === "all") && !(minDiscount > 0)) {
      setState({ loading: false, products: [], total: 0, facets: null, chips: [] })
      return undefined
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    searchAPI.searchProducts({
      ...(q ? { q } : {}),
      ...(smart && q ? { smart: 1 } : {}),
      ...(smart && removedChips.length ? { smartExclude: removedChips.join(",") } : {}),
      ...(effectiveCategoryId ? { categoryId: effectiveCategoryId } : {}),
      ...(filters.brands.length ? { brand: filters.brands.join(",") } : {}),
      ...(filters.minPrice != null ? { minPrice: filters.minPrice } : {}),
      ...(filters.maxPrice != null ? { maxPrice: filters.maxPrice } : {}),
      ...(filters.inStockOnly ? { inStockOnly: true } : {}),
      ...(minDiscount > 0 ? { minDiscount } : {}),
      attrs: filters.attrs,
      zoneId,
      fulfilmentMode,
      sort,
      page,
      limit: PAGE_SIZE,
      facets: true,
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data || {}
        setState({
          loading: false,
          products: Array.isArray(data.products) ? data.products : [],
          total: Number(data.total) || 0,
          facets: data.facets || null,
          chips: data.smart?.appliedFilters || [],
        })
      })
      .catch(() => { if (!cancelled) setState({ loading: false, products: [], total: 0, facets: null, chips: [] }) })
    return () => { cancelled = true }
  }, [q, smart, removedChips, effectiveCategoryId, categorySlug, waitingForCategory, filters, sort, page, zoneId, fulfilmentMode, minDiscount])

  const update = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1) }
  const toggleBrand = (b) => update({ brands: filters.brands.includes(b) ? filters.brands.filter((x) => x !== b) : [...filters.brands, b] })
  const toggleAttr = (name, value) => {
    const cur = filters.attrs[name] || []
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
    update({ attrs: { ...filters.attrs, [name]: next } })
  }
  const anyFilter = filters.brands.length || filters.minPrice != null || filters.maxPrice != null || filters.inStockOnly || Object.values(filters.attrs).some((v) => v.length)

  // Quick category pages swap the filter rail for the subcategory rail
  // (QUICK_UI_SPEC.md). Search keeps the filters it has today.
  const quickRailItems = useMemo(() => {
    if (!isQuick || q || !selectedCat) return []
    const parent =
      tree.find((t) => t.id === selectedCat.id) ||
      tree.find((t) => (t.children || []).some((c) => c.id === selectedCat.id))
    return parent?.children?.length ? parent.children : []
  }, [isQuick, q, selectedCat, tree])
  const showQuickRail = quickRailItems.length > 0

  const { loading, products, total, facets, chips } = state
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const to = Math.min(page * PAGE_SIZE, total)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const heading = title || selectedCat?.name || (q ? `Results for "${q}"` : "All products")

  return (
    <div className="min-h-screen bg-wh-surface text-wh-text">
      <div
        className={cx(
          "mx-auto flex max-w-[1500px] px-3 py-4 sm:px-5",
          showQuickRail ? "flex-col gap-3 sm:flex-row sm:gap-4" : "gap-6",
        )}
      >
        {showQuickRail ? (
          <QuickSubcategoryRail items={quickRailItems} selectedId={selectedCat?.id} heading={heading} />
        ) : (
        <aside className="hidden w-[240px] shrink-0 lg:block" aria-label="Filters">
          {tree.length > 0 && onSelectCategory ? (
            <RailSection title="Category">
              <CategoryTree tree={tree} selectedId={selectedCat?.id || effectiveCategoryId} onSelect={onSelectCategory} />
            </RailSection>
          ) : null}
          {facets?.priceRange && facets.priceRange.max > 0 ? (
            <RailSection title="Price">
              <PriceFilter range={facets.priceRange} minPrice={filters.minPrice} maxPrice={filters.maxPrice} onApply={(minPrice, maxPrice) => update({ minPrice, maxPrice })} />
            </RailSection>
          ) : null}
          {facets?.brands?.length ? (
            <RailSection title="Brand">
              <div className="max-h-60 overflow-y-auto">
                {facets.brands.map((b) => (
                  <Check key={b.value} checked={filters.brands.includes(b.value)} onChange={() => toggleBrand(b.value)}>
                    {b.value} <span className="text-wh-muted">({b.count})</span>
                  </Check>
                ))}
              </div>
            </RailSection>
          ) : null}
          {(facets?.attributes || []).map((a) => (
            <RailSection key={a.name} title={a.name}>
              <div className="max-h-48 overflow-y-auto">
                {a.values.map((v) => (
                  <Check key={v.value} checked={(filters.attrs[a.name] || []).includes(v.value)} onChange={() => toggleAttr(a.name, v.value)}>
                    {v.value} <span className="text-wh-muted">({v.count})</span>
                  </Check>
                ))}
              </div>
            </RailSection>
          ))}
          <RailSection title="Availability">
            <Check checked={filters.inStockOnly} onChange={() => update({ inStockOnly: !filters.inStockOnly })}>In stock</Check>
          </RailSection>
          {anyFilter ? (
            <button type="button" onClick={() => update(EMPTY_FILTERS)} className={cx("mt-2 text-[14px] text-wh-link hover:text-wh-link-hover hover:underline", focusRing)}>
              Clear all filters
            </button>
          ) : null}
        </aside>
        )}

        <main className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold leading-7">{heading}</h1>
          <div className="mt-2 flex items-center justify-between gap-4 border-b border-wh-border pb-3">
            <p className="text-[14px] text-wh-text" aria-live="polite">
              {loading ? "Loading results…" : total ? (
                <>{from}-{to} of {total} results{q ? <> for <span className="font-bold text-wh-link-hover">"{q}"</span></> : null}</>
              ) : "No results"}
            </p>
            <label className="flex items-center gap-2 text-[13px] text-wh-muted">
              Sort by
              <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }} className={cx("h-8 rounded-[8px] border border-wh-border bg-[#F0F2F2] px-2 text-[13px] text-wh-text", focusRing)}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          {smart && chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Filters read from your search">
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => { setRemovedChips((prev) => [...prev, chip.id]); setPage(1) }}
                  className={cx("inline-flex items-center gap-1 rounded-full border border-wh-border bg-[#F0F2F2] px-3 py-1 text-[13px] text-wh-text hover:bg-[#E3E6E6]", focusRing)}
                  aria-label={`Remove filter ${chip.label}`}
                >
                  {chip.label} <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-4">
            {loading ? (
              isQuick ? <QuickGridSkeleton count={12} /> : (
              <TileGrid>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="animate-pulse rounded-[8px] border border-wh-border p-3">
                    <div className="aspect-square rounded-[4px] bg-[#F0F2F2]" />
                    <div className="mt-3 h-3 w-3/4 rounded bg-[#F0F2F2]" />
                    <div className="mt-2 h-3 w-1/3 rounded bg-[#F0F2F2]" />
                  </div>
                ))}
              </TileGrid>
              )
            ) : products.length ? (
              isQuick ? <QuickProductGrid products={products} /> : (
              <TileGrid>
                {products.map((p) => (
                  <ListingTile key={p._id} product={p} channel={channel} onAddToCart={addToCart} />
                ))}
              </TileGrid>
              )
            ) : (
              <div className="py-16 text-center">
                <p className="text-[16px] font-bold">No products match{q ? ` "${q}"` : ""}.</p>
                <p className="mt-1 text-[14px] text-wh-muted">Try fewer filters or a different search.</p>
              </div>
            )}
          </div>

          {!loading && pages > 1 ? (
            <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pages">
              <button type="button" disabled={page <= 1} onClick={() => { setPage(page - 1); window.scrollTo(0, 0) }} className={cx("inline-flex h-9 items-center gap-1 rounded-[8px] border border-wh-border px-3 text-[14px] disabled:opacity-40", focusRing)}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </button>
              <span className="px-2 text-[14px]">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => { setPage(page + 1); window.scrollTo(0, 0) }} className={cx("inline-flex h-9 items-center gap-1 rounded-[8px] border border-wh-border px-3 text-[14px] disabled:opacity-40", focusRing)}>
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </nav>
          ) : null}
        </main>
      </div>
    </div>
  )
}
