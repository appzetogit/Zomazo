import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Heart, Store } from "lucide-react"
import { catalogAPI } from "@/services/api"
import { useProfile } from "@store/context/ProfileContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import MobileTopBar from "./MobileTopBar"
import ProductTile from "./ProductTile"

/**
 * The wishlist from the mobile mockup (screen 9): saved products in the same
 * two-column cards as everywhere else, so a size can be picked and added
 * straight from here, then the saved stores.
 *
 * Saved items only keep an id, so each one is fetched fresh: prices, stock and
 * sizes are today's, and anything no longer sold drops out quietly.
 */

export default function MobileWishlist() {
  const { storePath } = useStoreMode()
  const { getDishFavorites, getFavorites, removeDishFavorite } = useProfile()
  const saved = getDishFavorites()
  const stores = getFavorites()
  const [products, setProducts] = useState({})
  const [loading, setLoading] = useState(true)

  const key = useMemo(() => saved.map((s) => `${s.id}:${s.sellerId}`).join(","), [saved])

  useEffect(() => {
    let cancelled = false
    const ids = [...new Set(saved.map((s) => String(s.id)).filter(Boolean))]
    if (!ids.length) {
      setProducts({})
      setLoading(false)
      return undefined
    }
    setLoading(true)
    Promise.all(
      ids.map((id) =>
        catalogAPI
          .getProduct(id)
          .then((r) => {
            const d = r?.data?.data || r?.data
            if (!d?.product) return null
            const s = d.seller || {}
            return [id, { ...d.product, seller: { _id: s._id || d.product.sellerId, name: s.sellerName || s.name } }]
          })
          .catch(() => null),
      ),
    )
      .then((rows) => !cancelled && setProducts(Object.fromEntries(rows.filter(Boolean))))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // The key changes exactly when the saved list does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const live = saved.map((s) => products[String(s.id)]).filter(Boolean)
  const gone = loading ? [] : saved.filter((s) => !products[String(s.id)])

  return (
    <div className="min-h-screen bg-[#F7F7F8] pb-8 lg:hidden">
      <MobileTopBar
        title="My Wishlist"
        subtitle={loading ? "" : `${live.length} item${live.length === 1 ? "" : "s"}`}
        actions={["search", "cart"]}
      />

      <div className="px-3 pt-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-3" role="status" aria-label="Loading wishlist">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl bg-white">
                <div className="aspect-[4/5] animate-pulse bg-gray-200/80" />
                <div className="space-y-2 p-2.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200/80" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200/80" />
                </div>
              </div>
            ))}
          </div>
        ) : live.length ? (
          <div className="grid grid-cols-2 gap-3">
            {live.map((p) => (
              <ProductTile key={p._id} product={p} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF1E7]">
              <Heart className="h-7 w-7 text-[#EA580C]" aria-hidden="true" />
            </span>
            <p className="mt-3 text-[16px] font-bold text-gray-900">Your wishlist is empty</p>
            <p className="mt-1 text-[13px] text-gray-500">Tap the heart on anything you like to keep it here.</p>
            <Link to={storePath("/")} className="mt-4 rounded-xl bg-[#EA580C] px-5 py-2.5 text-[14px] font-bold text-white">
              Start shopping
            </Link>
          </div>
        )}

        {gone.length ? (
          <div className="mt-3 rounded-2xl bg-white p-3">
            <p className="text-[13px] font-semibold text-gray-800">
              {gone.length === 1 ? "1 saved item is" : `${gone.length} saved items are`} no longer sold
            </p>
            <button
              type="button"
              onClick={() => gone.forEach((g) => removeDishFavorite(g.id, g.sellerId))}
              className="mt-1 text-[13px] font-semibold text-[#EA580C]"
            >
              Remove {gone.length === 1 ? "it" : "them"}
            </button>
          </div>
        ) : null}

        {stores.length ? (
          <section className="mt-5" aria-label="Saved stores">
            <h2 className="mb-2 px-1 text-[16px] font-bold text-gray-900">Saved stores</h2>
            <div className="space-y-2">
              {stores.map((s) => (
                <Link
                  key={s.slug}
                  to={storePath(`/sellers/${s.slug}`)}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 active:scale-[0.99]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-100 bg-gray-50">
                    {s.image ? <img src={s.image} alt="" className="h-full w-full object-cover" /> : <Store className="h-5 w-5 text-gray-400" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gray-900">{s.name}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
