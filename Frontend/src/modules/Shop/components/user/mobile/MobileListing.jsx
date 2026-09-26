import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowUpDown, ChevronDown, SlidersHorizontal, X } from "lucide-react"
import { catalogAPI, searchAPI } from "@/services/api"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { usePublicCategories } from "../desktop/useDesktopShell"
import FilterSheet, { EMPTY_MOBILE_FILTERS, activeFilterCount } from "./FilterSheet"
import MobileTopBar from "./MobileTopBar"
import ProductTile from "./ProductTile"

/**
 * The product listing from the mobile mockup (screen 2), for a category, a
 * search or a discount page: top bar with the count, subcategory chips, sort
 * and filter chips, a two-column grid, and more on demand.
 */

const PAGE = 20
const SORTS = [
  ["relevance", "Relevance"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["rating", "Customer rating"],
  ["newest", "Newest first"],
]

const slugify = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Search API params for a set of filters. */
const filterParams = (f) => ({
  ...(f.brands.length ? { brand: f.brands.join(",") } : {}),
  ...(f.minPrice != null ? { minPrice: f.minPrice } : {}),
  ...(f.maxPrice != null ? { maxPrice: f.maxPrice } : {}),
  attrs: {
    ...(f.sizes.length ? { Size: f.sizes } : {}),
    ...(f.colours.length ? { Colour: f.colours } : {}),
  },
})

function SortSheet({ open, value, onPick, onClose }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label="Sort">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="wh-slide-up-bar absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200" />
        <h2 className="mb-2 text-[16px] font-bold text-gray-900">Sort by</h2>
        {SORTS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              onPick(key)
              onClose()
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2 py-3 text-left text-[14px] ${
              value === key ? "font-bold text-[#EA580C]" : "text-gray-800"
            }`}
          >
            {label}
            {value === key ? <span className="h-2 w-2 rounded-full bg-[#EA580C]" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function MobileListing({ categorySlug = "", q = "", minDiscount = null, title, withTopBar = true }) {
  const navigate = useNavigate()
  const { storePath, fulfilmentMode, isQuick } = useStoreMode()
  const { zoneId } = useDeliveryLocation()
  const { categories } = usePublicCategories(zoneId)

  const [filters, setFilters] = useState(EMPTY_MOBILE_FILTERS)
  const [sort, setSort] = useState("relevance")
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ loading: true, products: [], total: 0, facets: null })
  const [sheet, setSheet] = useState("")
  const [swatches, setSwatches] = useState({})

  // The category this page is about, its parent, and the chips to show.
  const current = useMemo(
    () => categories.find((c) => slugify(c.name) === String(categorySlug).toLowerCase() || c.id === categorySlug) || null,
    [categories, categorySlug],
  )
  const parent = current?.parentId ? categories.find((c) => c.id === current.parentId) : current
  const chips = parent ? categories.filter((c) => c.parentId === parent.id) : []
  const waiting = Boolean(categorySlug) && categorySlug !== "all" && !current && !categories.length

  useEffect(() => {
    catalogAPI
      .getAttributes()
      .then((res) => {
        const list = res?.data?.data?.attributes || res?.data?.data || []
        const map = {}
        for (const a of Array.isArray(list) ? list : []) {
          for (const v of a?.values || []) if (v?.hex) map[String(v.value).toLowerCase()] = v.hex
        }
        setSwatches(map)
      })
      .catch(() => {})
  }, [])

  // A new category or query starts from the top with no filters.
  useEffect(() => {
    setFilters(EMPTY_MOBILE_FILTERS)
    setPage(1)
  }, [categorySlug, q, minDiscount])

  const baseParams = useMemo(
    () => ({
      ...(q ? { q, smart: 1 } : {}),
      // A category id this session's list doesn't know yet (added since it
      // loaded) still filters, rather than falling back to everything.
      ...(current
        ? { categoryId: current.id }
        : /^[a-f0-9]{24}$/i.test(String(categorySlug))
          ? { categoryId: categorySlug }
          : {}),
      ...(minDiscount > 0 ? { minDiscount } : {}),
      fulfilmentMode,
      ...(isQuick && zoneId ? { zoneId } : {}),
    }),
    [q, current, categorySlug, minDiscount, fulfilmentMode, isQuick, zoneId],
  )

  useEffect(() => {
    if (waiting) return undefined
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    searchAPI
      .searchProducts({ ...baseParams, ...filterParams(filters), sort, page, limit: PAGE, facets: true })
      .then((res) => {
        if (cancelled) return
        const d = res?.data?.data || {}
        const list = Array.isArray(d.products) ? d.products : []
        setState((s) => ({
          loading: false,
          products: page === 1 ? list : [...s.products, ...list],
          total: Number(d.total) || 0,
          // Facets from the unfiltered first page, so options don't vanish as you pick.
          facets: page === 1 && !activeFilterCount(filters) ? d.facets || s.facets : s.facets || d.facets,
        }))
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }))
      })
    return () => {
      cancelled = true
    }
  }, [baseParams, filters, sort, page, waiting])

  const countFor = useCallback(
    (draft) =>
      searchAPI
        .searchProducts({ ...baseParams, ...filterParams(draft), limit: 1 })
        .then((res) => Number(res?.data?.data?.total) || 0),
    [baseParams],
  )

  const heading = title || current?.name || (q ? `"${q}"` : /^[a-f0-9]{24}$/i.test(String(categorySlug)) ? "Products" : "All products")
  const nFilters = activeFilterCount(filters)
  const chip = (on) =>
    `flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
      on ? "border-[#EA580C] bg-[#FFF1E7] text-[#C2410C]" : "border-gray-200 bg-white text-gray-700"
    }`

  return (
    <div className="min-h-screen bg-[#F7F7F8] pb-6 lg:hidden">
      {withTopBar ? (
        <MobileTopBar
          title={heading}
          subtitle={state.loading && page === 1 ? "Loading…" : `${state.total.toLocaleString("en-IN")} product${state.total === 1 ? "" : "s"}`}
        />
      ) : null}

      {/* Under the page's own top bar the chips stick; under the big search header they scroll. */}
      <div className={`${withTopBar ? "sticky top-14 z-30" : ""} space-y-2 border-b border-gray-100 bg-white pb-2 pt-2`}>
        {!withTopBar ? (
          <p className="px-3 text-[13px] text-gray-600">
            {state.loading && page === 1 ? "Searching…" : (
              <>
                <span className="font-bold text-gray-900">{state.total.toLocaleString("en-IN")}</span> result{state.total === 1 ? "" : "s"}
                {q ? <> for <span className="font-semibold text-gray-900">&ldquo;{q}&rdquo;</span></> : title ? <> · {title}</> : null}
              </>
            )}
          </p>
        ) : null}
        {chips.length ? (
          <div className="flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => parent && navigate(storePath(`/category/${slugify(parent.name)}`))}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold ${
                current?.id === parent?.id ? "bg-[#EA580C] text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              All
            </button>
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(storePath(`/category/${slugify(c.name)}`))}
                className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold ${
                  current?.id === c.id ? "bg-[#EA580C] text-white" : "bg-gray-100 text-gray-700"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => setSheet("sort")} className={chip(sort !== "relevance")}>
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" /> Sort <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setSheet("filter")} className={chip(filters.brands.length > 0)}>
            Brand <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setSheet("filter")} className={chip(filters.sizes.length > 0)}>
            Size <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setSheet("filter")} className={chip(filters.minPrice != null || filters.maxPrice != null)}>
            Price <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setSheet("filter")} className={chip(nFilters > 0)}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Filter{nFilters ? ` (${nFilters})` : ""}
          </button>
          {nFilters ? (
            <button type="button" onClick={() => setFilters(EMPTY_MOBILE_FILTERS)} className="flex shrink-0 items-center gap-1 px-2 text-[12px] font-semibold text-[#EA580C]">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-3 pt-3">
        {state.loading && page === 1 ? (
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl bg-white">
                <div className="aspect-[4/5] animate-pulse bg-gray-200/80" />
                <div className="space-y-1.5 p-2.5">
                  <div className="h-3 w-4/5 animate-pulse rounded bg-gray-200/80" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200/80" />
                  <div className="h-8 w-full animate-pulse rounded-lg bg-gray-200/80" />
                </div>
              </div>
            ))}
          </div>
        ) : state.products.length ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              {state.products.map((p) => (
                <ProductTile key={p._id} product={p} />
              ))}
            </div>
            {state.products.length < state.total ? (
              <button
                type="button"
                disabled={state.loading}
                onClick={() => setPage((n) => n + 1)}
                className="mx-auto mt-4 block rounded-full border border-[#EA580C] px-6 py-2 text-[13px] font-bold text-[#EA580C] disabled:opacity-50"
              >
                {state.loading ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl bg-white p-8 text-center">
            <p className="text-[15px] font-semibold text-gray-900">Nothing matches yet</p>
            <p className="mt-1 text-[13px] text-gray-500">
              {nFilters ? "Try removing a filter." : isQuick ? "Try Shop for delivery across India." : "Try another category."}
            </p>
          </div>
        )}
      </div>

      <SortSheet open={sheet === "sort"} value={sort} onPick={(k) => { setSort(k); setPage(1) }} onClose={() => setSheet("")} />
      <FilterSheet
        open={sheet === "filter"}
        onClose={() => setSheet("")}
        value={filters}
        onApply={(f) => {
          setFilters(f)
          setPage(1)
        }}
        facets={state.facets}
        swatches={swatches}
        countFor={countFor}
      />
    </div>
  )
}
