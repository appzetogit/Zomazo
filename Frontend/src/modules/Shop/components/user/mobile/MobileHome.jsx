import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, BadgeCheck, Bike, ChevronRight, Heart, RefreshCw, ShieldCheck, Star, Store, Truck } from "lucide-react"
import { catalogAPI, sellerAPI } from "@/services/api"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useProfile } from "@store/context/ProfileContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { mediaUrl } from "../desktop/desktopCart"
import { useQuickEta } from "../desktop/useDeliveryEstimates"
import { usePublicCategories } from "../desktop/useDesktopShell"
import { percentOff } from "../desktop/ui"
import ProductTile from "./ProductTile"
import { useQuickLayout } from "../quick-mobile/QuickLayoutContext"
import { CampaignBanner, FeaturedRail } from "../quick-mobile/QuickFeed"
import QuickRateNudge from "../quick-mobile/QuickRateNudge"

/**
 * The phone home from the mobile mockup (screen 1), for Shop and Quick alike:
 * banner carousel, promises, shop by category, top brands, featured stores,
 * then product rails and a grid.
 *
 * Every section is real data — the admin's hero banners, the catalogue's
 * categories, brands and products, and the stores near the address — so what
 * a shopper taps can be bought.
 */

const sectionTitle = "text-[17px] font-bold text-gray-900"
const viewAll = "flex items-center gap-0.5 text-[13px] font-semibold text-[#EA580C]"
const slugify = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

function SectionHead({ title, subtitle, to }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-4">
      <div className="min-w-0">
        <h2 className={sectionTitle}>{title}</h2>
        {subtitle ? <p className="text-[12px] text-gray-500">{subtitle}</p> : null}
      </div>
      {to ? (
        <Link to={to} className={viewAll}>
          View All <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  )
}

/** Banner cards that advance on their own and can be swiped. */
function BannerCarousel({ banners = [] }) {
  const { storePath } = useStoreMode()
  const track = useRef(null)
  const [index, setIndex] = useState(0)
  const slides = banners.filter((b) => b?.imageUrl)

  useEffect(() => {
    if (slides.length < 2) return undefined
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined
    const timer = setInterval(() => {
      const el = track.current
      if (!el || document.hidden) return
      const next = (index + 1) % slides.length
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" })
    }, 4500)
    return () => clearInterval(timer)
  }, [index, slides.length])

  if (!slides.length) return null

  return (
    <section aria-label="Offers" className="px-4">
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((b, i) => (
          <Link
            key={`${b.imageUrl}-${i}`}
            to={storePath(b.ctaLink || "/categories")}
            className="relative aspect-[16/9] w-full shrink-0 snap-center overflow-hidden rounded-2xl bg-[#FFF1E7]"
          >
            <img
              src={mediaUrl(b.imageUrl)}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              className={`h-full w-full object-cover ${i === index ? "wh-kenburns" : ""}`}
            />
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/25 to-transparent" />
            <span className="absolute inset-y-0 left-0 flex w-[70%] flex-col justify-center gap-1.5 p-4">
              {b.title ? (
                <span className="font-display text-[22px] font-bold leading-[1.1] text-white drop-shadow">{b.title}</span>
              ) : null}
              {b.subtitle ? <span className="line-clamp-2 text-[11px] text-white/85">{b.subtitle}</span> : null}
              <span className="wh-sheen relative mt-1 inline-flex w-fit items-center gap-1 overflow-hidden rounded-full bg-gray-900 px-3.5 py-1.5 text-[12px] font-bold text-white">
                {b.ctaText || "Shop Now"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </span>
          </Link>
        ))}
      </div>
      {slides.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
          {slides.map((b, i) => (
            <span
              key={`${b.imageUrl}-dot-${i}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-5 bg-[#EA580C]" : "w-1.5 bg-gray-300"}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Promises({ storeCount }) {
  const { isQuick } = useStoreMode()
  const eta = useQuickEta()
  const items = [
    isQuick
      ? { icon: Bike, top: "Delivery in", bottom: `${eta} min` }
      : { icon: Truck, top: "Delivered in", bottom: "2-4 days" },
    { icon: Store, top: storeCount ? `${storeCount} Local` : "Verified", bottom: "Stores" },
    { icon: RefreshCw, top: "Easy", bottom: "Returns" },
    { icon: ShieldCheck, top: "100%", bottom: "Secure Pay" },
  ]
  return (
    <section aria-label="Why shop with us" className="grid grid-cols-4 gap-2 px-4">
      {items.map(({ icon: Icon, top, bottom }) => (
        <div key={bottom} className="flex flex-col items-center gap-1 rounded-xl bg-white px-1 py-2.5 text-center shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFF1E7] text-[#EA580C]">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-[10px] leading-tight text-gray-500">{top}</span>
          <span className="-mt-0.5 text-[11px] font-bold leading-tight text-gray-900">{bottom}</span>
        </div>
      ))}
    </section>
  )
}

function CategoryRow({ categories = [] }) {
  const { storePath } = useStoreMode()
  if (!categories.length) return null
  return (
    <section aria-label="Shop by category">
      <SectionHead title="Shop by Category" to={storePath("/categories")} />
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categories.map((c) => (
          <Link key={c.id} to={storePath(`/category/${slugify(c.name)}`)} className="w-[72px] shrink-0 text-center active:scale-95">
            <span className="block aspect-square overflow-hidden rounded-2xl bg-[#FFF1E7]">
              {c.image ? (
                <img src={mediaUrl(c.image)} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-[20px] font-black text-[#EA580C]">{c.name.slice(0, 1)}</span>
              )}
            </span>
            <span className="mt-1 block truncate text-[11px] font-semibold text-gray-800">{c.name}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function BrandRow({ brands = [] }) {
  const { storePath } = useStoreMode()
  if (brands.length < 2) return null
  return (
    <section aria-label="Top brands">
      <SectionHead title="Top Brands" />
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {brands.map((brand) => (
          <Link
            key={brand}
            to={`${storePath("/search")}?${new URLSearchParams({ q: brand })}`}
            className="w-[64px] shrink-0 text-center active:scale-95"
          >
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white text-[15px] font-black uppercase tracking-tight text-gray-900 shadow-sm">
              {brand
                .split(/\s+/)
                .map((w) => w[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span className="mt-1 block truncate text-[11px] font-medium text-gray-700">{brand}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function FeaturedStores({ stores = [] }) {
  const { storePath } = useStoreMode()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  if (!stores.length) return null
  return (
    <section aria-label="Featured stores">
      <SectionHead title="Featured Stores" to={storePath("/sellers")} />
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {stores.map((s) => {
          const slug = s.slug || s._id
          const cover = mediaUrl(s.coverImages?.[0] || s.profileImage)
          const liked = isFavorite(slug)
          return (
            <Link
              key={s._id}
              to={storePath(`/sellers/${slug}`)}
              className="relative w-[64%] shrink-0 overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:scale-[0.99]"
            >
              <span className="relative block aspect-[16/10] bg-gray-100">
                {cover ? <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                <button
                  type="button"
                  aria-label={liked ? "Unfollow store" : "Save store"}
                  aria-pressed={liked}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (liked) removeFavorite(slug)
                    else addFavorite({ slug, name: s.sellerName, image: mediaUrl(s.profileImage), id: s._id })
                  }}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm"
                >
                  <Heart className={`h-4 w-4 ${liked ? "fill-[#E4322B] text-[#E4322B]" : "text-gray-700"}`} aria-hidden="true" />
                </button>
              </span>
              <span className="flex items-center gap-2 p-2.5">
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-gray-100 bg-white">
                  {s.profileImage ? <img src={mediaUrl(s.profileImage)} alt="" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold text-gray-900">{s.sellerName}</span>
                  <span className="flex items-center gap-1 text-[11px] text-gray-500">
                    {Number(s.rating) > 0 ? (
                      <>
                        <Star className="h-3 w-3 fill-[#1E9E48] text-[#1E9E48]" aria-hidden="true" />
                        {Number(s.rating).toFixed(1)} ·
                      </>
                    ) : null}
                    {Number.isFinite(Number(s.distanceKm)) ? `${Number(s.distanceKm).toFixed(1)} km` : s.location?.area || ""}
                  </span>
                </span>
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/** A horizontal rail of product cards, two and a sliver per screen. */
function ProductRail({ title, subtitle, products = [], to }) {
  if (products.length < 2) return null
  return (
    <section aria-label={title}>
      <SectionHead title={title} subtitle={subtitle} to={to} />
      <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (
          <div key={p._id} className="w-[46%] shrink-0 snap-start">
            <ProductTile product={p} />
          </div>
        ))}
      </div>
    </section>
  )
}

const shimmer = "animate-pulse bg-gray-200/80"

export function MobileHomeSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5 bg-[#F7F7F8] py-4">
      <div className={`mx-4 aspect-[16/9] rounded-2xl ${shimmer}`} />
      <div className="grid grid-cols-4 gap-2 px-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-[74px] rounded-xl ${shimmer}`} />
        ))}
      </div>
      <div className="flex gap-3 overflow-hidden px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`h-[72px] w-[72px] shrink-0 rounded-2xl ${shimmer}`} />
        ))}
      </div>
      <div className="flex gap-3 overflow-hidden px-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={`aspect-[4/7] w-[46%] shrink-0 rounded-2xl ${shimmer}`} />
        ))}
      </div>
    </div>
  )
}

export default function MobileHome({ heroBanners = [], products = [], loading = false }) {
  const { isQuick, storePath } = useStoreMode()
  const { effectiveLocation, zoneId } = useDeliveryLocation()
  // The public category tree: real images and parents, one request per zone.
  const { categories } = usePublicCategories(zoneId)
  // Quick's admin-edited extras (featured cards, campaigns); empty outside Quick.
  const { layout } = useQuickLayout()
  const [stores, setStores] = useState([])

  const lat = effectiveLocation?.latitude
  const lng = effectiveLocation?.longitude
  useEffect(() => {
    let cancelled = false
    // Nearest first when the address is known; otherwise every approved store.
    const request =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? catalogAPI.getNearbyStores({ lat, lng, limit: 10, ...(isQuick ? { fulfilmentMode: "quick" } : {}) })
        : sellerAPI.getSellers({ limit: 10 })
    request
      .then((res) => {
        const d = res?.data?.data
        const list = d?.stores || d?.sellers || (Array.isArray(d) ? d : [])
        if (!cancelled) setStores(list.map((s) => ({ ...s, sellerName: s.sellerName || s.name })))
      })
      .catch(() => {
        if (!cancelled) setStores([])
      })
    return () => {
      cancelled = true
    }
  }, [lat, lng, isQuick])

  // Top-level categories first, then their children, so the row starts broad.
  const categoryRow = useMemo(() => {
    const withName = categories.filter((c) => c?.name)
    const parents = withName.filter((c) => !c.parentId)
    const children = withName.filter((c) => c.parentId)
    return [...parents, ...children].slice(0, 14)
  }, [categories])

  const brands = useMemo(() => {
    const count = new Map()
    for (const p of products) {
      const b = String(p?.brand || "").trim()
      if (b) count.set(b, (count.get(b) || 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b).slice(0, 10)
  }, [products])

  const deals = useMemo(
    () =>
      products
        .map((p) => ({ p, off: percentOff(p.displayPrice ?? p.price, p.mrp) || 0 }))
        .filter((x) => x.off > 0)
        .sort((a, b) => b.off - a.off)
        .map((x) => x.p)
        .slice(0, 12),
    [products],
  )
  const trending = useMemo(
    () => [...products].sort((a, b) => (Number(b.totalRatings) || 0) - (Number(a.totalRatings) || 0)).slice(0, 12),
    [products],
  )

  // Featured stores: only those selling something here, nearest first.
  const sellingIds = new Set(products.map((p) => String(p.sellerId || p.seller?._id || "")))
  const featuredStores = stores.filter((s) => sellingIds.has(String(s._id)))

  if (loading && !products.length) return <MobileHomeSkeleton />

  return (
    <div className="space-y-6 bg-[#F7F7F8] pb-8 pt-3 lg:hidden">
      <BannerCarousel banners={heroBanners} />
      <Promises storeCount={featuredStores.length} />
      <CategoryRow categories={categoryRow} />
      <ProductRail
        title={isQuick ? "Trending Near You" : "Trending Now"}
        subtitle={isQuick ? "Popular with shoppers near you" : "What everyone is buying"}
        products={trending}
      />
      {isQuick ? <FeaturedRail items={layout.featured} /> : null}
      <BrandRow brands={brands} />
      <FeaturedStores stores={featuredStores} />
      {isQuick ? <CampaignBanner campaign={layout.campaigns[0]} /> : null}
      <ProductRail title="Deals of the Day" subtitle="The biggest savings right now" products={deals} to={`${storePath("/search")}?minDiscount=10`} />

      {products.length ? (
        <section aria-label="More to explore">
          <SectionHead title="More to Explore" />
          <div className="grid grid-cols-2 gap-3 px-4">
            {products.slice(0, 20).map((p) => (
              <ProductTile key={p._id} product={p} />
            ))}
          </div>
        </section>
      ) : (
        <p className="px-4 text-center text-[14px] text-gray-500">
          {isQuick ? "Nothing is available for quick delivery here yet." : "New products are on their way."}
        </p>
      )}

      {isQuick ? layout.campaigns.slice(1).map((c) => <CampaignBanner key={c._id || c.title} campaign={c} />) : null}

      <p className="flex items-center justify-center gap-1 px-4 text-center text-[11px] text-gray-400">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Every store here is verified before it can sell
      </p>
      <QuickRateNudge />
    </div>
  )
}
