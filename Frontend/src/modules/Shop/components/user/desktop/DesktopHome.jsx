import { useEffect, useMemo, useState } from "react"
import { catalogAPI, searchAPI, orderAPI } from "@store/api"
import { useStoreMode } from "@store/context/StoreModeContext"
import { isModuleAuthenticated } from "@store/utils/auth"
import { resolveMediaUrl } from "@/shared/utils/mediaUrl"
import HeroCarousel from "./HeroCarousel"
import { HomeSkeleton } from "./HomeSkeletons"
import {
  BoutiqueStoresSection,
  CollectionTiles,
  CuratedEditsSection,
  FeatureBand,
  Marquee,
  ProductRailSection,
  TrustStrip,
} from "../storefront/HomeSections"
import { useDesktopAddToCart } from "./desktopCart"
import { percentOff } from "./ui"
import useIsDesktop from "./useIsDesktop"
import MobileHome from "../mobile/MobileHome"

const PRODUCT_LIMIT = 50

const firstImage = (p) => {
  const raw = p?.image || (Array.isArray(p?.images) ? (typeof p.images[0] === "string" ? p.images[0] : p.images[0]?.url) : "")
  return raw ? resolveMediaUrl(raw) : ""
}

/** Normalise a catalogue product for the tiles (resolved image, display price). */
const toTile = (p) => ({
  ...p,
  image: firstImage(p),
  price: p.displayPrice ?? p.price,
  mrp: p.mrp ?? p.variants?.[0]?.mrp,
})

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, "-")

export default function DesktopHome({ heroBanners = [], categories = [], zoneId, onOpenBanner, etaMinutes }) {
  const isDesktop = useIsDesktop()
  const { storePath, fulfilmentMode, isQuick } = useStoreMode()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [orderItems, setOrderItems] = useState([])
  const [recommended, setRecommended] = useState([])
  const signedIn = isModuleAuthenticated("user")
  const addToCart = useDesktopAddToCart()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    searchAPI
      .searchProducts({ limit: PRODUCT_LIMIT, fulfilmentMode, ...(zoneId ? { zoneId } : {}) })
      .then((res) => { if (!cancelled) setProducts((res?.data?.data?.products || []).map(toTile)) })
      .catch(() => { if (!cancelled) setProducts([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fulfilmentMode, zoneId])

  useEffect(() => {
    if (!signedIn) { setOrderItems([]); return undefined }
    let cancelled = false
    orderAPI
      .getOrders({ page: 1, limit: 10 })
      .then((res) => {
        const d = res?.data?.data
        const orders = d?.orders || (Array.isArray(d) ? d : []) || []
        const seen = new Set()
        const items = []
        for (const o of orders) {
          for (const it of o?.items || []) {
            const id = String(it?.itemId || "")
            if (!id || seen.has(id)) continue
            seen.add(id)
            items.push({ id, name: it.name, image: it.image ? resolveMediaUrl(it.image) : "" })
          }
        }
        if (!cancelled) setOrderItems(items)
      })
      .catch(() => { if (!cancelled) setOrderItems([]) })
    return () => { cancelled = true }
  }, [signedIn])

  const productById = useMemo(() => new Map(products.map((p) => [String(p._id), p])), [products])

  // Seed "You may also like" from the most recent ordered product this store sells, else the top product.
  const seedId = useMemo(() => {
    const ordered = orderItems.find((it) => productById.has(it.id))
    return ordered?.id || (products[0]?._id ? String(products[0]._id) : null)
  }, [orderItems, productById, products])

  useEffect(() => {
    if (!seedId) { setRecommended([]); return undefined }
    let cancelled = false
    catalogAPI
      .getProductRecommendations(seedId, { type: "similar", fulfilmentMode, limit: 15 })
      .then((res) => { if (!cancelled) setRecommended((res?.data?.data?.products || []).map(toTile)) })
      .catch(() => { if (!cancelled) setRecommended([]) })
    return () => { cancelled = true }
  }, [seedId, fulfilmentMode])

  const deals = useMemo(
    () => products
      .map((p) => ({ p, off: percentOff(p.price, p.mrp) || 0 }))
      .filter((x) => x.off > 0)
      .sort((a, b) => b.off - a.off)
      .map((x) => x.p),
    [products],
  )

  // Dedicated fashion category product rails
  const tshirtProducts = useMemo(
    () => products.filter((p) => /t-shirt|tee|polo/i.test(p.categoryName || p.name)),
    [products],
  )
  const jeansProducts = useMemo(
    () => products.filter((p) => /jean|denim|pant|jogger|trouser/i.test(p.categoryName || p.name)),
    [products],
  )
  const festiveProducts = useMemo(
    () => products.filter((p) => /kurta|dress|festive|ethnic|silk|top/i.test(p.categoryName || p.name)),
    [products],
  )
  const jacketProducts = useMemo(
    () => products.filter((p) => /jacket|hoodie|bomber|outerwear|sweatshirt/i.test(p.categoryName || p.name)),
    [products],
  )

  // Product categories ranked by how many products they have here.
  const productGroups = useMemo(() => {
    const byCat = new Map()
    for (const p of products) {
      const key = String(p.categoryId || p.categoryName || "")
      if (!key || !p.categoryName) continue
      if (!byCat.has(key)) byCat.set(key, { id: key, name: p.categoryName, items: [] })
      byCat.get(key).items.push(p)
    }
    return [...byCat.values()].sort((a, b) => b.items.length - a.items.length)
  }, [products])

  const categoryLink = (id, name) => {
    const match = categories.find((c) => String(c.id) === String(id) || c.name === name)
    return storePath(`/category/${match?.slug || slugify(name)}`)
  }

  // Collection tiles: every category that actually has products here.
  const collectionTiles = productGroups.slice(0, 12).map((group) => {
    const match = categories.find(
      (c) => String(c.id) === String(group.id) || c.name === group.name,
    )
    return {
      id: group.id,
      label: group.name,
      image: match?.image || firstImage(group.items[0]),
      to: categoryLink(group.id, group.name),
    }
  })

  const marqueeItems = [
    isQuick ? `Quick delivery in ${etaMinutes || 10} minutes` : "Free express delivery on orders over ₹799",
    "100% Verified Boutique Apparel & Premium Fabrics",
    "Flat 10% Warehouses Coins on Every Order",
    "Hassle-free 7-day size exchanges & doorstep returns",
  ]

  // Hold the page's shape while the catalogue loads, instead of flashing an
  // empty screen and then pushing everything down.
  // Phones get the mobile storefront (screen 1 of the mobile mockup).
  if (!isDesktop) {
    return <MobileHome heroBanners={heroBanners} products={products} loading={loading} />
  }

  if (loading) return <HomeSkeleton />

  const recommendedList = recommended.filter((p) => p?._id)

  return (
    <div className="min-h-screen bg-wh-page pb-12">
      {/* Hero, inset and rounded like the reference (MOBILE_UI_SPEC.md) */}
      <div className="mx-auto max-w-[1500px] px-3 pt-3 sm:px-5">
        <div className="overflow-hidden rounded-2xl shadow-sm">
          <HeroCarousel banners={heroBanners} onOpen={onOpenBanner} />
        </div>
      </div>

      <div className="mx-auto max-w-[1500px] space-y-6 px-3 py-4 sm:px-5 sm:space-y-8">
        <TrustStrip />

        <Marquee items={marqueeItems} />

        <CollectionTiles
          title={isQuick ? "Shop essentials by category" : "Wardrobe Collections"}
          subtitle="Handpicked pure apparel & fashion collections"
          tiles={collectionTiles}
          seeAllTo="/categories"
        />

        {/* Curated Style Lookbook Grid */}
        <CuratedEditsSection />

        {/* Today's Fashion Deals */}
        <ProductRailSection
          title="Today's Fashion Deals"
          subtitle="Top savings on premium contemporary apparel"
          products={deals.slice(0, 20)}
          onAdd={addToCart}
          auto={5200}
        />

        {/* Trending T-Shirts & Polos Rail */}
        {tshirtProducts.length >= 3 ? (
          <ProductRailSection
            title="Trending T-Shirts & Polos"
            subtitle="Heavyweight Supima cotton, graphic drop-shoulders & classic piques"
            products={tshirtProducts}
            onAdd={addToCart}
          />
        ) : null}

        {/* Featured Fashion Boutiques */}
        <BoutiqueStoresSection />

        {/* Indigo Denim & Trousers Rail */}
        {jeansProducts.length >= 3 ? (
          <ProductRailSection
            title="Denim & Trousers Studio"
            subtitle="Raw selvedge slim-tapered denim, relaxed straight cuts & modern chinos"
            products={jeansProducts}
            onAdd={addToCart}
          />
        ) : null}

        {/* Artisanal Festive & Ethnic Wear Rail */}
        {festiveProducts.length >= 3 ? (
          <ProductRailSection
            title="Artisanal Festive & Ethnic Glamour"
            subtitle="Pure Chanderi silks, handloom weaves & regal anarkalis"
            products={festiveProducts}
            onAdd={addToCart}
          />
        ) : null}

        {/* Jackets & Winterwear Rail */}
        {jacketProducts.length >= 3 ? (
          <ProductRailSection
            title="Jackets & Layering Essentials"
            subtitle="Vintage trucker denim jackets, minimalist bombers & French Terry hoodies"
            products={jacketProducts}
            onAdd={addToCart}
          />
        ) : null}

        <FeatureBand
          title="Sell on The Warehouses"
          subtitle="Showcase your designer apparel and boutique collections to millions across India."
          ctaLabel="Start selling"
          ctaTo="/seller/signup"
        />

        {recommendedList.length > 0 ? (
          <ProductRailSection
            title="You may also like"
            subtitle="Picked from what you have been browsing"
            products={recommendedList}
            onAdd={addToCart}
          />
        ) : null}

        {!deals.length && !recommendedList.length && !products.length ? (
          <section className="rounded-2xl border border-wh-border bg-wh-surface p-8 text-center text-wh-muted">
            {isQuick ? "Nothing is available for quick delivery here yet." : "New fashion collections are on their way. Check back soon."}
          </section>
        ) : null}
      </div>
    </div>
  )
}

