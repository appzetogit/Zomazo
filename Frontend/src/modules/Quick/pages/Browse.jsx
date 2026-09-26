import { useEffect, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { quickAPI } from "../api"
import { useQuickLocation } from "../context/QuickLocationContext"
import { GridSkeleton, ProductGrid } from "../components/ProductCard"
import { cx, focusRing, isRealImage, mediaUrl } from "../helpers"

/**
 * Category and search results: products across the stores serving the
 * customer's zone. A category page adds the Shop's left category rail.
 */
const PAGE = 40

function CategoryRail({ categories, activeId }) {
  return (
    <nav aria-label="Categories" className="flex gap-2 overflow-x-auto pb-2 sm:sticky sm:top-[132px] sm:w-[96px] sm:shrink-0 sm:flex-col sm:self-start sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {categories.map((c) => {
        const id = String(c._id || c.id)
        const active = id === activeId
        const img = mediaUrl(c.image)
        return (
          <Link key={id} to={`/quick/category/${id}`} aria-current={active ? "page" : undefined}
            className={cx("relative flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-[8px] px-1 py-2 text-center sm:w-full", active ? "bg-wh-brand-50" : "hover:bg-black/5", focusRing)}>
            {active ? <span className="absolute left-0 top-2 hidden h-[calc(100%-16px)] w-[3px] rounded-r bg-wh-brand-ink sm:block" /> : null}
            <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#F7F7F7]">
              {isRealImage(img) ? <img src={img} alt="" className="h-9 w-9 object-contain" /> : <span className="font-black text-wh-brand-ink">{String(c.name).charAt(0)}</span>}
            </span>
            <span className={cx("line-clamp-2 text-[11px] leading-[14px]", active ? "font-bold text-wh-text" : "text-wh-muted")}>{c.name}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default function Browse({ mode }) {
  const { categoryId } = useParams()
  const [params] = useSearchParams()
  const q = params.get("q") || ""
  const { zoneId, zoneStatus } = useQuickLocation()
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (mode === "category") quickAPI.categories(zoneId).then(setCategories).catch(() => {})
  }, [mode, zoneId])

  useEffect(() => {
    setPage(1)
  }, [categoryId, q, zoneId])

  useEffect(() => {
    if (zoneStatus === "loading") return undefined
    let cancelled = false
    setLoading(true)
    quickAPI
      .products({ zoneId, q: mode === "search" ? q : undefined, categoryId: mode === "category" ? categoryId : undefined, page, limit: PAGE })
      .then((r) => {
        if (cancelled) return
        setTotal(r.total || 0)
        setProducts((prev) => (page === 1 ? r.products || [] : [...prev, ...(r.products || [])]))
      })
      .catch(() => !cancelled && setProducts([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [mode, categoryId, q, zoneId, zoneStatus, page])

  const category = categories.find((c) => String(c._id || c.id) === categoryId)
  const title = mode === "search" ? (q ? `Results for "${q}"` : "Search") : category?.name || "Category"

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-3 py-3 sm:flex-row lg:px-6">
      {mode === "category" && categories.length ? <CategoryRail categories={categories} activeId={categoryId} /> : null}
      <section className="min-w-0 flex-1 rounded-[8px] bg-wh-surface px-3 py-4 sm:px-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-[19px] font-black leading-6 tracking-tight">{title}</h1>
          {!loading || page > 1 ? <span className="text-[12px] text-wh-muted">{total} item{total === 1 ? "" : "s"}</span> : null}
        </div>
        {loading && page === 1 ? (
          <GridSkeleton count={12} />
        ) : products.length ? (
          <>
            <ProductGrid products={products} />
            {products.length < total ? (
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
            {mode === "search" ? `Nothing matches "${q}" near you.` : "Nothing in this category near you yet."}
          </p>
        )}
      </section>
    </div>
  )
}
