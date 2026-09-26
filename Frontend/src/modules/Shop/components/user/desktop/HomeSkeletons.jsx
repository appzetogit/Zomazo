/**
 * Loading shapes for the storefront home.
 *
 * Each one mirrors the real component it stands in for — same card shell, same
 * grid, same image ratios and text-line widths — so the page keeps its layout
 * while it loads instead of shifting when the content lands.
 */

const shimmer = "animate-pulse bg-[#E9ECEF]"

/** The hero banner's footprint, at each of its three heights. */
export function HeroSkeleton() {
  return (
    <div className={`h-[260px] w-full sm:h-[340px] lg:h-[440px] ${shimmer}`} aria-hidden="true" />
  )
}

/** A centred section heading: title, subtitle, divider. */
function HeadingSkeleton() {
  return (
    <div className="mb-4 text-center sm:mb-6">
      <div className={`mx-auto h-7 w-56 rounded ${shimmer}`} />
      <div className={`mx-auto mt-2 h-3 w-44 rounded ${shimmer}`} />
      <div className={`mx-auto mt-3 h-[3px] w-14 rounded-full ${shimmer}`} />
    </div>
  )
}

/** Matches a Rail of ProductCards: two rows of 46vw cards on a phone. */
export function RailSkeleton() {
  return (
    <section>
      <HeadingSkeleton />
      <div className="grid grid-flow-col grid-rows-2 auto-cols-[46vw] gap-3 overflow-hidden sm:auto-cols-[31vw] lg:auto-cols-[200px] lg:grid-rows-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-wh-border bg-wh-surface">
            <div className={`aspect-[4/5] w-full ${shimmer}`} />
            <div className="space-y-1.5 p-2">
              <div className={`h-3 w-full rounded ${shimmer}`} />
              <div className={`h-3 w-2/3 rounded ${shimmer}`} />
              <div className={`h-4 w-1/2 rounded ${shimmer}`} />
              <div className={`h-7 w-full rounded-full ${shimmer}`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Matches TrustStrip: four cards, two across on a phone. */
export function TrustStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-2xl border border-wh-border bg-wh-surface p-2.5">
          <div className={`h-9 w-9 shrink-0 rounded-xl ${shimmer}`} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className={`h-3 w-4/5 rounded ${shimmer}`} />
            <div className={`h-2.5 w-3/5 rounded ${shimmer}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Matches CollectionTiles: 4:5 tiles, two across on a phone. */
export function CollectionTilesSkeleton() {
  return (
    <section>
      <HeadingSkeleton />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`aspect-[4/5] rounded-2xl ${shimmer}`} />
        ))}
      </div>
    </section>
  )
}

/** The whole home page, in the order the real one renders. */
export function HomeSkeleton() {
  return (
    <div className="min-h-screen bg-wh-page pb-12" role="status" aria-label="Loading the storefront">
      <div className="mx-auto max-w-[1500px] px-3 pt-3 sm:px-5">
        <div className="overflow-hidden rounded-2xl">
          <HeroSkeleton />
        </div>
      </div>
      <div className="mx-auto max-w-[1500px] space-y-6 px-3 py-4 sm:space-y-8 sm:px-5">
        <TrustStripSkeleton />
        <div className={`h-9 w-full rounded-2xl ${shimmer}`} />
        <CollectionTilesSkeleton />
        <RailSkeleton />
      </div>
    </div>
  )
}

/**
 * Matches ProductDetailDesktop: breadcrumb, then gallery, details and buy box
 * — three columns at lg, stacked below it.
 */
export function ProductDetailSkeleton() {
  return (
    <div className="min-h-screen bg-wh-surface" role="status" aria-label="Loading the product">
      <div className="mx-auto max-w-[1500px] px-3 sm:px-5">
        <div className={`my-3 h-3 w-64 max-w-full rounded ${shimmer}`} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_260px] lg:gap-6 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)_300px]">
          {/* Gallery: thumbnails sit under the image on a phone, beside it above */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <div className="flex w-full gap-2 sm:w-[52px] sm:flex-col">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`h-[52px] w-[52px] shrink-0 rounded-[8px] ${shimmer}`} />
              ))}
            </div>
            <div className={`aspect-square w-full rounded-[8px] ${shimmer}`} />
          </div>

          {/* Name, price, options */}
          <div>
            <div className={`h-6 w-11/12 rounded ${shimmer}`} />
            <div className={`mt-2 h-3 w-40 rounded ${shimmer}`} />
            <div className={`mt-5 h-8 w-32 rounded ${shimmer}`} />
            <div className={`mt-2 h-3 w-28 rounded ${shimmer}`} />
            <div className="mt-5 flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`h-9 w-12 rounded-[8px] ${shimmer}`} />
              ))}
            </div>
            <div className="mt-5 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`h-3 w-full rounded ${shimmer}`} />
              ))}
            </div>
          </div>

          {/* Buy box */}
          <div className="rounded-[8px] border border-wh-border p-4">
            <div className={`h-7 w-24 rounded ${shimmer}`} />
            <div className={`mt-3 h-3 w-40 rounded ${shimmer}`} />
            <div className={`mt-2 h-3 w-28 rounded ${shimmer}`} />
            <div className={`mt-4 h-9 w-full rounded-full ${shimmer}`} />
            <div className={`mt-2 h-9 w-full rounded-full ${shimmer}`} />
            <div className={`mt-4 h-3 w-32 rounded ${shimmer}`} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * What the app shows before a storefront route's code has loaded: the header's
 * bands and then the home page's shape, so the first paint is already the
 * storefront rather than an unrelated placeholder.
 */
export function StorefrontShellSkeleton() {
  return (
    <div className="min-h-screen bg-gray-100/70" role="status" aria-label="Loading the storefront">
      {/* Top bar: two rows on a phone, one from lg */}
      <div className="bg-gradient-to-r from-[#d95d08] via-[#ea580c] to-[#f97316]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-2 gap-y-1.5 px-2.5 py-2 lg:h-[62px] lg:flex-nowrap lg:px-[20px] lg:py-[6px]">
          <div className="h-[28px] w-[74px] rounded bg-white/25 lg:h-[42px] lg:w-[145px]" />
          <div className="h-5 w-24 rounded bg-white/25" />
          <div className="ml-auto h-6 w-28 rounded-full bg-white/25" />
          <div className="h-6 w-6 rounded-full bg-white/25" />
          <div className="h-6 w-6 rounded-full bg-white/25" />
          <div className="order-last h-[42px] w-full rounded-[8px] bg-white/80 lg:order-none lg:mx-2 lg:w-auto lg:flex-1" />
        </div>
      </div>
      {/* Category bar */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-[42px] max-w-[1500px] items-center gap-3 px-3 lg:px-[20px]">
          <div className={`h-[32px] w-[68px] rounded-[4px] ${shimmer}`} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`h-3 w-16 rounded ${shimmer}`} />
          ))}
        </div>
      </div>
      <HeroSkeleton />
      <div className="relative z-20 mx-auto -mt-6 max-w-[1500px] space-y-4 px-3 sm:px-5 lg:-mt-16 lg:space-y-6">
        <TrustStripSkeleton />
        <CollectionTilesSkeleton />
      </div>
    </div>
  )
}
