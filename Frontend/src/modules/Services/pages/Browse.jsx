import { useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { BadgeCheck, SlidersHorizontal, Star } from "lucide-react"
import { servicesAPI } from "../api"
import { useCatalogIndex, useLoad } from "../hooks"
import ServiceCard from "../components/ServiceCard"
import { EmptyState, Skeleton, Thumb, cx, focusRing } from "../helpers"

const PRICE_BANDS = [
  { id: "all", label: "Any price", test: () => true },
  { id: "u500", label: "Under ₹500", test: (p) => p < 500 },
  { id: "500-1500", label: "₹500 - ₹1,500", test: (p) => p >= 500 && p <= 1500 },
  { id: "o1500", label: "Over ₹1,500", test: (p) => p > 1500 },
]

const SORTS = [
  { id: "relevance", label: "Recommended" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "name", label: "Name" },
]

const norm = (s) => String(s || "").toLowerCase()

/**
 * Search text matches anywhere in a service's title, brand or description.
 * The server's own search only matches the start of a title ("clean" would
 * miss "Deep cleaning"), so the list is fetched whole and filtered here; the
 * catalogue is a few hundred services at most.
 */
const matches = (s, q) => {
  if (!q) return true
  const hay = `${norm(s.title)} ${norm(s.brandName)} ${norm(s.description)}`
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold",
        active ? "border-violet-600 bg-violet-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-violet-300",
        focusRing
      )}
    >
      {children}
    </button>
  )
}

function Providers({ categoryId }) {
  const { data, loading, error } = useLoad(() => servicesAPI.providers(categoryId), [categoryId])
  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, n) => (
          <Skeleton key={n} className="h-24" />
        ))}
      </div>
    )
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>
  const providers = data?.providers || []
  if (!providers.length) {
    return <EmptyState title="No professionals listed yet" text="You can still book: we will find the nearest available professional." />
  }
  return (
    <>
      <p className="mb-3 text-xs text-gray-500">
        Bookings go to the nearest available professional, so you do not pick one. These are the people who work in
        this category.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => (
          <li key={p.id} className="flex gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <Thumb src={p.photo} name={p.name} className="h-14 w-14 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 font-extrabold text-gray-900">
                <span className="truncate">{p.name}</span>
                <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Verified" />
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-600">
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                  {p.rating ? p.rating.toFixed(1) : "New"}
                  {p.totalReviews ? ` (${p.totalReviews})` : ""}
                </span>
                <span>{p.completedJobs} jobs done</span>
                {p.city ? <span>{p.city}</span> : null}
              </p>
              {p.skills?.length ? <p className="mt-1 truncate text-[11px] text-gray-500">{p.skills.join(" · ")}</p> : null}
            </div>
            {p.isOnline ? (
              <span className="self-start rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Online</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}

/** A category's services (mode "category") or search across all (mode "search"). */
export default function Browse({ mode }) {
  const { categoryId } = useParams()
  const [params] = useSearchParams()
  const q = mode === "search" ? norm(params.get("q")).trim() : ""
  const index = useCatalogIndex()
  const category = mode === "category" ? index.categoryById(categoryId) : null

  const services = useLoad(
    () => (mode === "category" ? servicesAPI.services({ categoryId }) : servicesAPI.services()),
    [mode, categoryId]
  )
  const brands = useLoad(() => (mode === "category" ? servicesAPI.brands(categoryId) : Promise.resolve([])), [mode, categoryId])

  const [tab, setTab] = useState("services")
  const [brand, setBrand] = useState("all")
  const [band, setBand] = useState("all")
  const [sort, setSort] = useState("relevance")
  const [showFilters, setShowFilters] = useState(false)

  // The same component serves every category and the search, so moving between
  // them keeps its state; a brand filter from one category means nothing in the next.
  useEffect(() => {
    setTab("services")
    setBrand("all")
  }, [mode, categoryId])

  const list = useMemo(() => {
    const priceTest = PRICE_BANDS.find((b) => b.id === band)?.test || (() => true)
    const out = (services.data || []).filter(
      (s) => matches(s, q) && (brand === "all" || String(s.brandId) === brand) && priceTest(Number(s.basePrice) || 0)
    )
    if (sort === "price-asc") out.sort((a, b) => a.basePrice - b.basePrice)
    if (sort === "price-desc") out.sort((a, b) => b.basePrice - a.basePrice)
    if (sort === "name") out.sort((a, b) => String(a.title).localeCompare(String(b.title)))
    return out
  }, [services.data, q, brand, band, sort])

  const filtersOn = brand !== "all" || band !== "all" || sort !== "relevance"
  const title =
    mode === "category" ? category?.title || "Services" : q ? `Results for "${params.get("q")}"` : "All services"

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <h1 className="text-xl font-extrabold text-gray-900">{title}</h1>

      {mode === "category" ? (
        <div className="mt-3 flex gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
          {[
            ["services", "Services"],
            ["pros", "Professionals"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx(
                "flex-1 rounded-lg py-2 text-sm font-bold",
                tab === id ? "bg-white text-violet-700 shadow-sm" : "text-gray-600",
                focusRing
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "pros" && mode === "category" ? (
        <div className="mt-4">
          <Providers categoryId={categoryId} />
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              className={cx(
                "flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-bold",
                filtersOn ? "border-violet-600 text-violet-700" : "border-gray-200 text-gray-700",
                focusRing
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Filters
            </button>
            {(brands.data || []).length > 1 ? (
              <>
                <Chip active={brand === "all"} onClick={() => setBrand("all")}>
                  All
                </Chip>
                {brands.data.map((b) => (
                  <Chip key={b.id} active={brand === b.id} onClick={() => setBrand(brand === b.id ? "all" : b.id)}>
                    {b.title}
                  </Chip>
                ))}
              </>
            ) : null}
          </div>

          {showFilters ? (
            <div className="mt-2 space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <fieldset>
                <legend className="text-xs font-bold uppercase tracking-wide text-gray-500">Price</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRICE_BANDS.map((b) => (
                    <Chip key={b.id} active={band === b.id} onClick={() => setBand(b.id)}>
                      {b.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-xs font-bold uppercase tracking-wide text-gray-500">Sort by</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SORTS.map((s) => (
                    <Chip key={s.id} active={sort === s.id} onClick={() => setSort(s.id)}>
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              {filtersOn ? (
                <button
                  type="button"
                  onClick={() => {
                    setBrand("all")
                    setBand("all")
                    setSort("relevance")
                  }}
                  className={cx("rounded text-xs font-bold text-violet-700", focusRing)}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            {services.loading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: 6 }, (_, n) => (
                  <Skeleton key={n} className="h-36" />
                ))}
              </div>
            ) : services.error ? (
              <EmptyState
                title="Could not load services"
                text={services.error}
                action={
                  <button type="button" onClick={() => services.reload()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
                    Try again
                  </button>
                }
              />
            ) : list.length ? (
              <>
                <p className="mb-2 text-xs text-gray-500">
                  {list.length} {list.length === 1 ? "service" : "services"}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {list.map((s) => (
                    <ServiceCard key={s.id} service={s} category={category || index.categoryOf(s)} />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                title={q ? "Nothing matches that" : "No services here yet"}
                text={q ? "Try a shorter word, or browse the categories." : filtersOn ? "Try clearing the filters." : undefined}
              />
            )}
          </div>
        </>
      )}
      <div className="h-24" />
    </div>
  )
}
