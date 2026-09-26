import { useMemo } from "react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { useLocationSelector } from "../UserLayout"
import { MIN_RAIL_PRODUCTS, QuickProductRail } from "../desktop/quick/QuickRail"
import { useQuickLayout } from "./QuickLayoutContext"
import QuickThemeBlock from "./QuickThemeBlock"
import { CampaignBanner, CategoryGroup, FeaturedRail, FrequentlyBought } from "./QuickFeed"
import QuickRateNudge from "./QuickRateNudge"

/**
 * The Quick storefront's home on a phone (QUICK_MOBILE_SPEC.md), laid out like
 * the instant-delivery apps: the chosen theme's block, then frequently bought,
 * featured this week, deals, campaigns and category groups.
 *
 * QuickHome owns the product data and passes it down; the layout (themes,
 * featured, campaigns, groups) comes from QuickLayoutContext, which the header
 * shares so its tabs and this block agree on the chosen theme.
 */

const skeleton = "animate-pulse rounded-xl bg-black/[0.06]"

function QuickMobileSkeleton() {
  return (
    <div role="status" aria-label="Loading Quick" className="space-y-5 pb-6">
      <div className="bg-wh-brand-50 px-4 pb-4 pt-4">
        <div className="grid grid-cols-3 gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`aspect-[106/102] ${skeleton}`} />
          ))}
        </div>
        <div className={`mt-3 h-[60px] rounded-2xl ${skeleton}`} />
        <div className={`mt-3 h-9 rounded-lg ${skeleton}`} />
      </div>
      <div className="px-4">
        <div className={`mb-3 h-5 w-44 ${skeleton}`} />
        <div className="flex gap-3 overflow-hidden">
          <div className={`aspect-[3/1.35] w-[88%] shrink-0 rounded-2xl ${skeleton}`} />
          <div className={`aspect-[3/1.35] w-[88%] shrink-0 rounded-2xl ${skeleton}`} />
        </div>
      </div>
      <div className="px-4">
        <div className={`mb-3 h-5 w-40 ${skeleton}`} />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`aspect-[105/125] w-[30%] shrink-0 rounded-2xl ${skeleton}`} />
          ))}
        </div>
      </div>
      <div className="px-4">
        <div className={`mb-3 h-5 w-36 ${skeleton}`} />
        <div className="grid grid-cols-4 gap-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`aspect-square ${skeleton}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function QuickMobileHome({
  products = [],
  productsLoading = false,
  deals = [],
  groups = [],
  orderedIds = [],
  categoryLink,
  outOfZone = false,
  areaName = "",
}) {
  const { storePath } = useStoreMode()
  const { openLocationSelector } = useLocationSelector()
  const { layout, loading: layoutLoading, activeTheme } = useQuickLayout()

  // "Frequently bought": what this customer ordered, grouped by category; for
  // a guest (or a first order) the categories selling most here.
  const frequent = useMemo(() => {
    const byId = new Map(products.map((p) => [String(p._id || p.id), p]))
    const ordered = orderedIds.map((id) => byId.get(String(id))).filter(Boolean)
    const source = ordered.length >= 3 ? ordered : null

    const bucket = new Map()
    for (const p of source || products) {
      const key = String(p.categoryId || p.categoryName || "")
      if (!key || !p.categoryName) continue
      if (!bucket.has(key)) bucket.set(key, { id: key, name: p.categoryName, items: [] })
      const g = bucket.get(key)
      if (g.items.length < 3) g.items.push(p)
    }
    const list = [...bucket.values()]
      .filter((g) => g.items.length >= (source ? 1 : 3))
      .slice(0, 6)
      .map((g) => ({ ...g, to: categoryLink ? categoryLink(g.id, g.name) : storePath("/categories") }))
    return { title: source ? "Frequently bought" : "Popular right now", groups: list }
  }, [products, orderedIds, categoryLink, storePath])

  if (layoutLoading || (productsLoading && !products.length && !outOfZone)) {
    return <QuickMobileSkeleton />
  }

  const [firstCampaign, ...otherCampaigns] = layout.campaigns
  const topBestsellers = groups.filter((g) => g.items.length >= MIN_RAIL_PRODUCTS).slice(0, 1)

  return (
    <div className="wh-desktop min-h-screen bg-wh-surface pb-8 lg:hidden">
      <QuickThemeBlock theme={activeTheme} />

      <div className="space-y-7 pt-5">
        {outOfZone ? (
          <section role="status" className="mx-4 rounded-2xl border border-wh-border bg-wh-brand-50 p-4 text-center">
            <p className="text-[15px] font-bold text-wh-text">
              Quick delivery isn&apos;t available {areaName ? `at ${areaName}` : "here"} yet.
            </p>
            <button
              type="button"
              onClick={openLocationSelector}
              className="mt-2 rounded-lg border border-wh-brand-ink px-3 py-1.5 text-[13px] font-semibold text-wh-brand-ink"
            >
              Change location
            </button>
          </section>
        ) : null}

        {!outOfZone ? (
          <FrequentlyBought title={frequent.title} groups={frequent.groups} seeAllTo="/categories" />
        ) : null}

        <FeaturedRail items={layout.featured} />

        {!outOfZone && deals.length >= MIN_RAIL_PRODUCTS ? (
          <QuickProductRail title="Deals of the day" products={deals.slice(0, 20)} seeAllTo={storePath("/search?minDiscount=10")} />
        ) : null}

        <CampaignBanner campaign={firstCampaign} />

        {layout.categoryGroups.map((group) => (
          <CategoryGroup key={group.parentId} group={group} />
        ))}

        {!outOfZone
          ? topBestsellers.map((g) => (
              <QuickProductRail
                key={g.id}
                title={`Bestsellers in ${g.name}`}
                products={g.items.slice(0, 20)}
                seeAllTo={categoryLink ? categoryLink(g.id, g.name) : storePath("/categories")}
              />
            ))
          : null}

        {otherCampaigns.map((c) => (
          <CampaignBanner key={c._id || c.title} campaign={c} />
        ))}
      </div>

      <QuickRateNudge />
    </div>
  )
}
