/**
 * Left subcategory rail for Quick category pages (QUICK_UI_SPEC.md): ~90px
 * wide, sticky with its own scroll, icon above a 12px label, and the current
 * one marked by a brand-tinted pill with a left bar.
 */
import { Link } from "react-router-dom"
import { useStoreMode } from "@store/context/StoreModeContext"
import { isRealImage } from "../ui"
import { mediaUrl } from "../desktopCart"
import { cx, focusRing } from "./quickHelpers"

/**
 * items: [{ id, name, slug, image }] — the siblings to move between.
 * selectedId: the id of the category being shown.
 */
export default function QuickSubcategoryRail({ items = [], selectedId, heading }) {
  const { storePath } = useStoreMode()
  if (!items.length) return null
  return (
    <nav
      aria-label={heading || "Subcategories"}
      className="w-full shrink-0 border-b border-wh-border sm:w-[90px] sm:border-b-0 sm:border-r"
    >
      <div className="overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:sticky sm:top-[136px] sm:max-h-[calc(100vh-150px)] sm:overflow-x-visible sm:overflow-y-auto sm:[scrollbar-width:thin]">
        <ul className="flex gap-1 pr-1 sm:block sm:space-y-1">
          {items.map((c) => {
            const active = String(c.id) === String(selectedId)
            const img = mediaUrl(c.image)
            return (
              <li key={c.id} className="relative w-[76px] shrink-0 sm:w-auto">
                {active ? (
                  <span aria-hidden="true" className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r bg-wh-brand-ink" />
                ) : null}
                <Link
                  to={storePath(`/category/${c.slug}`)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-[8px] px-1 py-2",
                    active ? "bg-wh-brand-50 font-bold text-wh-brand-ink" : "hover:bg-[#F7F7F7]",
                    focusRing,
                  )}
                >
                  <span className="flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-[8px] bg-[#F7F7F7]">
                    {isRealImage(img) ? (
                      <img src={img} alt="" loading="lazy" className="h-full w-full object-contain" />
                    ) : (
                      <span aria-hidden="true" className="text-[15px] font-bold text-wh-muted">
                        {String(c.name || "").trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-2 text-center text-[12px] leading-[14px]">{c.name}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
