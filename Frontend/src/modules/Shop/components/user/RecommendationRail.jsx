import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ShoppingBag } from "lucide-react"
import { catalogAPI } from "@/services/api"
import { useStoreMode } from "@store/context/StoreModeContext"
import { resolveMediaUrl } from "@/shared/utils/mediaUrl"
import { ProductTile } from "@store/components/user/desktop/ui"

/**
 * A horizontal rail of recommended products for one product:
 * type "frequently_bought" (co-purchases) or "similar" (same category, close
 * price, shared attributes). Only what this storefront can deliver, in stock.
 * `fallbackType` is tried when the first type has nothing.
 * Renders nothing while loading, on error, or when empty.
 * variant "desktop" renders the lg+ card style (DESKTOP_THEME.md).
 */
export default function RecommendationRail({ productId, type = "similar", fallbackType = null, title, excludeIds = [], limit = 10, className = "", variant = "default" }) {
  const { fulfilmentMode, storePath } = useStoreMode()
  const [products, setProducts] = useState([])
  const excludeKey = excludeIds.map(String).sort().join(",")

  useEffect(() => {
    if (!productId) return undefined
    let cancelled = false
    const exclude = new Set(excludeKey ? excludeKey.split(",") : [])
    const load = (t) => catalogAPI
      .getProductRecommendations(productId, { type: t, fulfilmentMode, limit })
      .then((res) => (res?.data?.data?.products || []).filter((p) => !exclude.has(String(p._id))))
    load(type)
      .then((list) => (list.length || !fallbackType ? list : load(fallbackType)))
      .then((list) => { if (!cancelled) setProducts(list) })
      .catch(() => { if (!cancelled) setProducts([]) })
    return () => { cancelled = true }
  }, [productId, type, fallbackType, fulfilmentMode, limit, excludeKey])

  if (!products.length) return null

  if (variant === "desktop") {
    return (
      <section className={`w-full min-w-0 max-w-full overflow-hidden bg-wh-surface py-4 ${className}`} aria-label={title}>
        <h2 className="mb-3 text-[21px] font-bold leading-7 text-wh-text">{title}</h2>
        <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {products.map((p) => (
            <div key={p._id} className="w-[180px] shrink-0">
              <ProductTile
                product={{ ...p, price: p.displayPrice ?? p.price, image: p.image ? resolveMediaUrl(p.image) : "" }}
                href={storePath(`/product/${p._id}`)}
                compact
              />
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className={`w-full min-w-0 max-w-full overflow-hidden pt-4 ${className}`}>
      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 px-1">{title}</h3>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((p) => {
          const price = p.displayPrice ?? p.price
          const image = p.image ? resolveMediaUrl(p.image) : ""
          return (
            <Link
              key={p._id}
              to={storePath(`/product/${p._id}`)}
              className="snap-start shrink-0 w-32 rounded-xl border border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 hover:shadow-md transition-shadow"
            >
              <div className="w-full h-24 rounded-lg overflow-hidden bg-gray-50 dark:bg-zinc-800 flex items-center justify-center mb-2">
                {image ? (
                  <img src={image} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <ShoppingBag className="w-6 h-6 text-gray-300" />
                )}
              </div>
              <div className="text-xs font-semibold text-gray-900 dark:text-white line-clamp-2 min-h-[2rem]">{p.name}</div>
              {p.packSize && <div className="text-[10px] text-gray-500 mt-0.5">{p.packSize}</div>}
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xs font-bold text-gray-900 dark:text-white">
                  {p.hasVariants ? "From " : ""}₹{price}
                </span>
                {p.mrp > price && <span className="text-[10px] text-gray-400 line-through">₹{p.mrp}</span>}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
