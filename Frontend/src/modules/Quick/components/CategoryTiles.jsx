/**
 * "Shop by category" tiles, from the Shop's QuickCategoryTiles: square
 * brand-tinted tiles with the category's image contained, or its initial.
 */
import { Link } from "react-router-dom"
import { cx, focusRing, isRealImage, mediaUrl } from "../helpers"

export default function CategoryTiles({ categories = [], loading = false, title = "Shop by category", activeId }) {
  if (!loading && !categories.length) return null
  return (
    <section className="rounded-[8px] bg-wh-surface px-4 py-4 lg:px-5">
      <h2 className="mb-3 text-[19px] font-black leading-6 tracking-tight lg:font-bold">{title}</h2>
      <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5 lg:grid-cols-8">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse" aria-hidden="true">
                <div className="aspect-square rounded-[10px] bg-[#F0F2F2]" />
                <div className="mx-auto mt-2 h-3 w-3/4 rounded bg-[#F0F2F2]" />
              </div>
            ))
          : categories.map((c) => {
              const id = String(c._id || c.id)
              const img = mediaUrl(c.image)
              return (
                <Link key={id} to={`/quick/category/${id}`} className={cx("group flex flex-col items-center text-center", focusRing)}>
                  <span className={cx("flex aspect-square w-full items-center justify-center overflow-hidden rounded-[10px] bg-wh-brand-50 transition-transform group-hover:-translate-y-0.5", activeId === id && "ring-2 ring-wh-brand-ink")}>
                    {isRealImage(img) ? (
                      <img src={img} alt="" loading="lazy" className="h-4/5 w-4/5 object-contain" />
                    ) : (
                      <span className="text-[22px] font-black text-wh-brand-ink">{String(c.name || "?").charAt(0)}</span>
                    )}
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-4 text-wh-text">{c.name}</span>
                </Link>
              )
            })}
      </div>
    </section>
  )
}
