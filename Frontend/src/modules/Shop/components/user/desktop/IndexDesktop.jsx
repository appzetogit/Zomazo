/**
 * Desktop (lg+) index pages: the categories grid and the stores grid.
 * Both take the rows their pages already fetched.
 */
import { useState } from "react"
import { Link } from "react-router-dom"
import { Star, Clock, Search } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"

const cx = (...a) => a.filter(Boolean).join(" ")
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand"

function PageShell({ title, subtitle, filter, setFilter, placeholder, children }) {
  return (
    <div className="min-h-screen bg-wh-page text-wh-text">
      <div className="mx-auto max-w-[1500px] px-3 py-5 sm:px-5 sm:py-6">
        {/* The title and the filter stack on a phone; side by side from sm. */}
        <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-tight sm:text-[30px]">{title}</h1>
            {subtitle ? <p className="text-[14px] text-wh-muted">{subtitle}</p> : null}
          </div>
          <label className="relative w-full sm:w-80">
            <span className="sr-only">{placeholder}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wh-muted" aria-hidden="true" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={placeholder}
              className={cx("h-9 w-full rounded-[8px] border border-wh-border bg-wh-surface pl-9 pr-3 text-[14px]", focusRing)}
            />
          </label>
        </div>
        {children}
      </div>
    </div>
  )
}

const Skeleton = ({ n = 12, cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6" }) => (
  <div className={cx("grid gap-4", cols)}>
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className="animate-pulse rounded-[8px] bg-wh-surface p-4">
        <div className="aspect-square rounded-[4px] bg-[#F0F2F2]" />
        <div className="mt-3 h-3 w-2/3 rounded bg-[#F0F2F2]" />
      </div>
    ))}
  </div>
)

/** categories: [{ id, name, slug, image }] */
export function CategoriesDesktop({ categories = [], loading }) {
  const { storePath } = useStoreMode()
  const [filter, setFilter] = useState("")
  const rows = categories.filter((c) => (c.name || "").toLowerCase().includes(filter.trim().toLowerCase()))
  return (
    <PageShell title="Shop by category" subtitle={loading ? "" : `${categories.length} categories`} filter={filter} setFilter={setFilter} placeholder="Find a category">
      {loading ? <Skeleton /> : rows.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 2xl:grid-cols-6">
          {rows.map((c) => (
            <Link
              key={c.id}
              to={storePath(`/category/${c.slug}`)}
              className={cx("group flex flex-col rounded-[8px] bg-wh-surface p-4 hover:shadow-md", focusRing)}
            >
              <div className="aspect-square overflow-hidden rounded-[4px] bg-[#F7F7F7]">
                {c.image ? <img src={c.image} alt={c.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : null}
              </div>
              <span className="mt-3 line-clamp-2 text-[16px] font-bold leading-5">{c.name}</span>
              <span className="mt-1 text-[13px] text-wh-link group-hover:text-wh-link-hover group-hover:underline">Shop now</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-[14px] text-wh-muted">No categories match "{filter}".</p>
      )}
    </PageShell>
  )
}

/** stores: [{ id, slug, name, rating, deliveryTime, distance, image }] */
export function StoresDesktop({ stores = [], loading }) {
  const { storePath, isQuick } = useStoreMode()
  const [filter, setFilter] = useState("")
  const rows = stores.filter((s) => (s.name || "").toLowerCase().includes(filter.trim().toLowerCase()))
  return (
    <PageShell title="All stores" subtitle={loading ? "" : `${stores.length} stores`} filter={filter} setFilter={setFilter} placeholder="Find a store">
      {loading ? <Skeleton n={8} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" /> : rows.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
          {rows.map((s) => (
            <Link
              key={s.id}
              to={storePath(`/sellers/${s.slug}`)}
              className={cx("group flex flex-col overflow-hidden rounded-[8px] bg-wh-surface hover:shadow-md", focusRing)}
            >
              <div className="aspect-[16/9] bg-[#F0F2F2]">
                {s.image ? <img src={s.image} alt={s.name} loading="lazy" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="flex flex-col gap-1 p-4">
                <span className="truncate text-[16px] font-bold group-hover:text-wh-link-hover">{s.name}</span>
                <div className="flex items-center gap-3 text-[13px] text-wh-muted">
                  {s.rating ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-wh-brand text-wh-brand" aria-hidden="true" /> {Number(s.rating).toFixed(1)}
                    </span>
                  ) : null}
                  {isQuick && s.deliveryTime ? (
                    <span className="inline-flex items-center gap-1 text-wh-success">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {s.deliveryTime}
                    </span>
                  ) : null}
                  {isQuick && s.distance ? <span>{s.distance}</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-[14px] text-wh-muted">No stores match "{filter}".</p>
      )}
    </PageShell>
  )
}
