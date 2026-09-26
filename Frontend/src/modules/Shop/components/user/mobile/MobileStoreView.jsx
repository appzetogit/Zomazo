import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, Heart, MapPin, Search, Share2, Star, Truck, Zap } from "lucide-react"
import { toast } from "sonner"
import { sellerAPI } from "@/services/api"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useProfile } from "@store/context/ProfileContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { calculateDistanceKm } from "@store/utils/geo"
import { mediaUrl } from "../desktop/desktopCart"
import { useQuickEta } from "../desktop/useDeliveryEstimates"
import ProductTile from "./ProductTile"

/**
 * The store page from the mobile mockup (screen 3): cover photo under floating
 * buttons, the store's logo, name, rating, place and delivery, category chips
 * built from what it sells, and its products.
 */

const round = "flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-md active:scale-95"

export default function MobileStoreView({ slug }) {
  const navigate = useNavigate()
  const { isQuick, fulfilmentMode, storePath } = useStoreMode()
  const { effectiveLocation } = useDeliveryLocation()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  const eta = useQuickEta()
  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState("all")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      sellerAPI.getSellerById(slug).then((r) => r?.data?.data?.store || r?.data?.data?.seller || r?.data?.data || null),
      sellerAPI
        .getPublicProducts({ sellerId: slug, fulfilmentMode, limit: 200 })
        .then((r) => r?.data?.data?.products || [])
        .catch(() => []),
    ])
      .then(([s, list]) => {
        if (cancelled) return
        setStore(s)
        setProducts(Array.isArray(list) ? list : [])
      })
      .catch(() => !cancelled && setStore(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [slug, fulfilmentMode])

  // Chips: the categories this store actually sells, most stocked first.
  const categories = useMemo(() => {
    const count = new Map()
    for (const p of products) if (p.categoryName) count.set(p.categoryName, (count.get(p.categoryName) || 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [products])
  const shown = category === "all" ? products : products.filter((p) => p.categoryName === category)

  const km = store ? calculateDistanceKm(store.location || store, effectiveLocation) : null
  const liked = store ? isFavorite(slug) : false
  const cover = mediaUrl(store?.coverImages?.[0] || store?.coverImage || store?.galleryImages?.[0])

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: store?.sellerName, url: window.location.href })
      else {
        await navigator.clipboard.writeText(window.location.href)
        toast.success("Link copied")
      }
    } catch {
      /* dismissed */
    }
  }

  if (loading && !store) {
    return (
      <div className="min-h-screen bg-white lg:hidden" role="status" aria-label="Loading store">
        <div className="aspect-[16/10] animate-pulse bg-gray-200/80" />
        <div className="space-y-2 p-4">
          <div className="h-5 w-40 animate-pulse rounded bg-gray-200/80" />
          <div className="h-3 w-56 animate-pulse rounded bg-gray-200/80" />
        </div>
      </div>
    )
  }

  if (!store) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center lg:hidden">
        <p className="text-[16px] font-bold text-gray-900">This store isn&apos;t available</p>
        <button type="button" onClick={() => navigate(-1)} className="mt-3 rounded-lg bg-[#EA580C] px-4 py-2 text-[14px] font-bold text-white">
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F7F8] pb-8 lg:hidden">
      <div className="relative aspect-[16/10] bg-gray-200">
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/10" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Back" className={round}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={liked ? "Unsave store" : "Save store"}
              aria-pressed={liked}
              onClick={() => {
                if (liked) removeFavorite(slug)
                else addFavorite({ slug, id: store._id, name: store.sellerName, image: mediaUrl(store.profileImage) })
              }}
              className={round}
            >
              <Heart className={`h-4 w-4 ${liked ? "fill-[#E4322B] text-[#E4322B]" : ""}`} aria-hidden="true" />
            </button>
            <button type="button" onClick={share} aria-label="Share" className={round}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative -mt-8 rounded-t-3xl bg-white px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <span className="-mt-10 h-16 w-16 shrink-0 overflow-hidden rounded-full border-4 border-white bg-white shadow-md">
            {store.profileImage ? <img src={mediaUrl(store.profileImage)} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-bold text-gray-900">{store.sellerName}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-gray-600">
              {Number(store.rating) > 0 ? (
                <span className="flex items-center gap-0.5 font-semibold text-gray-800">
                  <Star className="h-3.5 w-3.5 fill-[#1E9E48] text-[#1E9E48]" aria-hidden="true" />
                  {Number(store.rating).toFixed(1)}
                  {Number(store.totalRatings) ? <span className="font-normal text-gray-500">({store.totalRatings})</span> : null}
                </span>
              ) : (
                <span className="text-gray-500">New store</span>
              )}
              <span className="flex items-center gap-0.5">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {[store.area || store.location?.area, store.city || store.location?.city].filter(Boolean).join(", ")}
              </span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-gray-800">
              {Number.isFinite(km) ? <span>{km.toFixed(1)} km</span> : null}
              <span className="flex items-center gap-1 text-[#157A38]">
                {isQuick ? <Zap className="h-3.5 w-3.5" aria-hidden="true" /> : <Truck className="h-3.5 w-3.5" aria-hidden="true" />}
                {isQuick ? `${eta} min delivery` : "2-4 days delivery"}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-30 border-b border-gray-100 bg-white py-2">
        <div className="flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["all", ...categories].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold ${
                category === c ? "bg-[#EA580C] text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
          <Link
            to={`${storePath("/search")}?${new URLSearchParams({ q: store.sellerName })}`}
            aria-label="Search this store"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <section className="px-3 pt-4" aria-label="Products">
        <h2 className="mb-3 px-1 text-[17px] font-bold text-gray-900">{category === "all" ? "Popular Products" : category}</h2>
        {shown.length ? (
          <div className="grid grid-cols-2 gap-3">
            {shown.map((p) => (
              <ProductTile key={p._id || p.id} product={{ ...p, seller: { _id: store._id, name: store.sellerName } }} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-white p-6 text-center text-[14px] text-gray-500">
            {isQuick ? "Nothing from this store for quick delivery right now." : "No products yet."}
          </p>
        )}
      </section>
    </div>
  )
}
