/**
 * Quick home promo banners (QUICK_UI_SPEC.md): the existing hero banners shown
 * as a 3-across row of wide cards, with arrows when there are more than three.
 * Renders nothing when the admin has no banners, so the page never shows a gap.
 */
import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { isVideoUrl } from "@store/utils/mediaType"
import { cx, focusRing } from "./quickHelpers"

const PER_PAGE = 3

export default function QuickPromoBanners({ banners = [], onOpen, loading = false }) {
  const slides = (Array.isArray(banners) ? banners : []).filter(
    (b) => b && typeof b.imageUrl === "string" && b.imageUrl,
  )
  const pages = Math.max(1, Math.ceil(slides.length / PER_PAGE))
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (page >= pages) setPage(0)
  }, [page, pages])

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="aspect-[16/7] animate-pulse rounded-[8px] bg-[#E8EAEA]" />
        ))}
      </div>
    )
  }

  if (!slides.length) return null

  const shown = slides.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  return (
    <section aria-label="Offers" className="relative">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        {shown.map((b, i) => (
          <button
            key={`${b.imageUrl}-${i}`}
            type="button"
            onClick={() => onOpen?.(b)}
            className={cx(
              "group relative block aspect-[16/7] w-full overflow-hidden rounded-[8px] bg-[#E8EAEA] text-left",
              focusRing,
            )}
          >
            {isVideoUrl(b.imageUrl) ? (
              <video src={b.imageUrl} className="h-full w-full object-cover" muted loop autoPlay playsInline />
            ) : (
              <img
                src={b.imageUrl}
                alt={b.title || "Offer"}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            )}
            {b.title ? (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-[13px] font-bold text-white">
                {b.title}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {pages > 1 ? (
        <>
          <button
            type="button"
            onClick={() => setPage((p) => (p - 1 + pages) % pages)}
            aria-label="Previous offers"
            className={cx(
              "absolute -left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-wh-border bg-wh-surface shadow-md",
              focusRing,
            )}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => (p + 1) % pages)}
            aria-label="More offers"
            className={cx(
              "absolute -right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-wh-border bg-wh-surface shadow-md",
              focusRing,
            )}
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </>
      ) : null}
    </section>
  )
}
