/**
 * Quick layout containers: the dense product grid and the horizontal rail.
 * Grid columns follow QUICK_UI_SPEC.md (6 at ≥1400px, 5 at 1280–1399, 4 at
 * 1024–1279, 12px gap).
 */
import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Link } from "react-router-dom"
import QuickProductCard, { QuickProductCardSkeleton } from "./QuickProductCard"
import { cx, focusRing, productId } from "./quickHelpers"

export const QUICK_GRID =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:max-wide:grid-cols-5 wide:grid-cols-6"

/** A rail needs this many products before it earns a row of its own. */
export const MIN_RAIL_PRODUCTS = 4

export function QuickProductGrid({ products = [], etaMinutes }) {
  return (
    <div className={QUICK_GRID}>
      {products.map((p) => (
        <QuickProductCard key={productId(p)} product={p} etaMinutes={etaMinutes} />
      ))}
    </div>
  )
}

export function QuickGridSkeleton({ count = 12 }) {
  return (
    <div className={QUICK_GRID} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <QuickProductCardSkeleton key={i} />
      ))}
    </div>
  )
}

function SectionHead({ title, seeAllTo, seeAllLabel = "see all" }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[19px] font-bold leading-6">{title}</h2>
      {seeAllTo ? (
        <Link
          to={seeAllTo}
          className={cx("shrink-0 text-[13px] font-medium text-wh-link hover:text-wh-link-hover hover:underline", focusRing)}
        >
          {seeAllLabel}
        </Link>
      ) : null}
    </div>
  )
}

/**
 * Horizontal row of Quick cards. Renders nothing below MIN_RAIL_PRODUCTS so a
 * thin or half-empty row never ships; pass `loading` for the skeleton row.
 */
export function QuickProductRail({ title, products = [], seeAllTo, etaMinutes, loading = false }) {
  const rowRef = useRef(null)
  const scroll = (dir) => {
    const el = rowRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" })
  }

  if (loading) {
    return (
      <section className="rounded-[8px] bg-wh-surface px-5 py-4">
        <SectionHead title={title} />
        <div className="flex gap-3 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="w-[175px] shrink-0">
              <QuickProductCardSkeleton />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (products.length < MIN_RAIL_PRODUCTS) return null

  return (
    <section className="rounded-[8px] bg-wh-surface px-5 py-4 text-wh-text">
      <SectionHead title={title} seeAllTo={seeAllTo} />
      <div className="relative">
        <div
          ref={rowRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {products.map((p) => (
            <div key={productId(p)} className="w-[175px] shrink-0">
              <QuickProductCard product={p} etaMinutes={etaMinutes} />
            </div>
          ))}
        </div>
        {products.length > 6 ? (
          <>
            <button
              type="button"
              onClick={() => scroll(-1)}
              aria-label={`Scroll ${title} left`}
              className={cx(
                "absolute -left-3 top-[100px] hidden h-9 w-9 items-center justify-center rounded-full border border-wh-border bg-wh-surface shadow-md lg:flex",
                focusRing,
              )}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => scroll(1)}
              aria-label={`Scroll ${title} right`}
              className={cx(
                "absolute -right-3 top-[100px] hidden h-9 w-9 items-center justify-center rounded-full border border-wh-border bg-wh-surface shadow-md lg:flex",
                focusRing,
              )}
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}

export { SectionHead }
