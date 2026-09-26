/**
 * The /quick desktop home (QUICK_UI_SPEC.md): category tiles, promo banners and
 * product rails built with the new Quick card. Data comes from the endpoints
 * the storefront already uses — searchAPI.searchProducts with
 * fulfilmentMode "quick", the public categories, the hero banners the page
 * fetched, and catalogAPI.getProductRecommendations for "You may also like".
 */
import { useEffect, useMemo, useState } from "react"
import { catalogAPI, orderAPI, searchAPI } from "@store/api"
import { useStoreMode } from "@store/context/StoreModeContext"
import { isModuleAuthenticated } from "@store/utils/auth"
import { useLocationSelector } from "../../UserLayout"
import { percentOff } from "../ui"
import { useQuickEta } from "../useDeliveryEstimates"
import { usePublicCategories } from "../useDesktopShell"
import QuickCategoryTiles from "./QuickCategoryTiles"
import QuickPromoBanners from "./QuickPromoBanners"
import { MIN_RAIL_PRODUCTS, QuickProductRail } from "./QuickRail"
import { productId, productPrice, productMrp } from "./quickHelpers"
import useIsDesktop from "../useIsDesktop"
import QuickMobileHome from "../../quick-mobile/QuickMobileHome"

const PRODUCT_LIMIT = 50

export default function QuickHome({ heroBanners = [], zoneId, onOpenBanner, outOfZone = false, areaName = "" }) {
  const { storePath, fulfilmentMode } = useStoreMode()
  const { openLocationSelector } = useLocationSelector()
  const eta = useQuickEta()
  const { tree, loading: categoriesLoading } = usePublicCategories(zoneId)

  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [recommended, setRecommended] = useState([])
  const [recommendedLoading, setRecommendedLoading] = useState(true)
  const [orderedIds, setOrderedIds] = useState([])
  const signedIn = isModuleAuthenticated("user")
  const isDesktop = useIsDesktop()

  useEffect(() => {
    if (outOfZone) {
      setProducts([])
      setProductsLoading(false)
      return undefined
    }
    let cancelled = false
    setProductsLoading(true)
    searchAPI
      .searchProducts({ limit: PRODUCT_LIMIT, fulfilmentMode, ...(zoneId ? { zoneId } : {}) })
      .then((res) => {
        if (cancelled) return
        setProducts(res?.data?.data?.products || [])
        setProductsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setProducts([])
        setProductsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fulfilmentMode, zoneId, outOfZone])

  useEffect(() => {
    if (!signedIn || outOfZone) {
      setOrderedIds([])
      return undefined
    }
    let cancelled = false
    orderAPI
      .getOrders({ page: 1, limit: 10 })
      .then((res) => {
        const d = res?.data?.data
        const orders = d?.orders || (Array.isArray(d) ? d : []) || []
        const ids = []
        for (const o of orders) {
          for (const it of o?.items || []) {
            const id = String(it?.itemId || "")
            if (id && !ids.includes(id)) ids.push(id)
          }
        }
        if (!cancelled) setOrderedIds(ids)
      })
      .catch(() => {
        if (!cancelled) setOrderedIds([])
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, outOfZone])

  // Seed the recommendations from something the customer bought that this store
  // sells, else the first quick product.
  const seedId = useMemo(() => {
    const available = new Set(products.map((p) => productId(p)))
    const ordered = orderedIds.find((id) => available.has(id))
    return ordered || productId(products[0]) || null
  }, [orderedIds, products])

  useEffect(() => {
    if (!seedId) {
      setRecommended([])
      setRecommendedLoading(false)
      return undefined
    }
    let cancelled = false
    setRecommendedLoading(true)
    catalogAPI
      .getProductRecommendations(seedId, { type: "similar", fulfilmentMode, limit: 15 })
      .then((res) => {
        if (cancelled) return
        setRecommended(res?.data?.data?.products || [])
        setRecommendedLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setRecommended([])
        setRecommendedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seedId, fulfilmentMode])

  const deals = useMemo(
    () =>
      products
        .map((p) => ({ p, off: percentOff(productPrice(p), productMrp(p)) || 0 }))
        .filter((x) => x.off > 0)
        .sort((a, b) => b.off - a.off)
        .map((x) => x.p),
    [products],
  )

  // Categories ranked by how many quick products they hold, for "Bestsellers in X".
  const groups = useMemo(() => {
    const byCat = new Map()
    for (const p of products) {
      const key = String(p.categoryId || p.categoryName || "")
      if (!key || !p.categoryName) continue
      if (!byCat.has(key)) byCat.set(key, { id: key, name: p.categoryName, items: [] })
      byCat.get(key).items.push(p)
    }
    return [...byCat.values()].sort((a, b) => b.items.length - a.items.length)
  }, [products])

  const allCats = useMemo(() => tree.flatMap((t) => [t, ...(t.children || [])]), [tree])
  const categoryLink = (id, name) => {
    const match = allCats.find((c) => String(c.id) === String(id) || c.name === name)
    return match ? storePath(`/category/${match.slug}`) : storePath("/categories")
  }

  const bestsellerGroups = groups.filter((g) => g.items.length >= MIN_RAIL_PRODUCTS).slice(0, 2)
  const nothingToShow =
    !productsLoading && !recommendedLoading && deals.length < MIN_RAIL_PRODUCTS && !bestsellerGroups.length && recommended.length < MIN_RAIL_PRODUCTS

  // Phones get the mobile storefront (screen 1 of the mobile mockup), on the
  // same product data as the desktop layout below.
  if (!isDesktop) {
    // Quick keeps its own instant-delivery phone home (QUICK_MOBILE_SPEC.md),
    // so it never looks like Shop.
    return (
      <QuickMobileHome
        products={products}
        productsLoading={productsLoading}
        deals={deals}
        groups={groups}
        orderedIds={orderedIds}
        categoryLink={categoryLink}
        outOfZone={outOfZone}
        areaName={areaName}
      />
    )
  }

  return (
    <div className="wh-desktop min-h-screen bg-wh-page pb-16">
      <div className="mx-auto max-w-[1500px] space-y-4 px-5 py-4">
        {outOfZone ? (
          <section className="rounded-[8px] border border-wh-border bg-wh-surface p-6 text-center" role="status">
            <h1 className="text-[19px] font-bold">Quick delivery isn&apos;t available {areaName ? `at ${areaName}` : "here"} yet.</h1>
            <p className="mt-1 text-[14px] text-wh-muted">
              Browse the categories below, or switch your delivery location to a served area.
            </p>
            <button
              type="button"
              onClick={openLocationSelector}
              className="mt-3 rounded-[8px] border border-wh-brand-ink bg-wh-brand-50 px-4 py-2 text-[13px] font-semibold text-wh-brand-ink hover:bg-wh-brand hover:text-wh-text"
            >
              Change location
            </button>
          </section>
        ) : null}

        <QuickCategoryTiles tree={tree} loading={categoriesLoading} title="Shop essentials by category" />

        {!outOfZone ? <QuickPromoBanners banners={heroBanners} onOpen={onOpenBanner} /> : null}

        {!outOfZone ? (
          <>
            {productsLoading ? (
              <QuickProductRail title="Deals of the day" loading />
            ) : (
              <QuickProductRail
                title="Deals of the day"
                products={deals.slice(0, 20)}
                seeAllTo={storePath("/offers")}
                etaMinutes={eta}
              />
            )}

            {bestsellerGroups.map((g) => (
              <QuickProductRail
                key={g.id}
                title={`Bestsellers in ${g.name}`}
                products={g.items.slice(0, 20)}
                seeAllTo={categoryLink(g.id, g.name)}
                etaMinutes={eta}
              />
            ))}

            {recommendedLoading && !recommended.length ? (
              <QuickProductRail title="You may also like" loading />
            ) : (
              <QuickProductRail title="You may also like" products={recommended} etaMinutes={eta} />
            )}

            {nothingToShow ? (
              <section className="rounded-[8px] bg-wh-surface p-8 text-center text-[14px] text-wh-muted">
                Nothing is available for quick delivery here yet.
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
