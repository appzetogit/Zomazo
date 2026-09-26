import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { mediaUrl } from "../desktop/desktopCart"
import Rail from "../storefront/Rail"
import Reveal from "../storefront/Reveal"
import AppLink from "./AppLink"

/**
 * The Quick phone home's feed below the themed block (QUICK_MOBILE_SPEC.md §1):
 * frequently bought, featured this week, campaign banners and category groups.
 * Each takes data the page already has; none of them fetch.
 */

const heading = "text-[19px] font-black tracking-tight text-wh-text"

const firstImage = (p) =>
  mediaUrl(p?.image || (Array.isArray(p?.images) ? (typeof p.images[0] === "string" ? p.images[0] : p.images[0]?.url) : ""))

/**
 * Groups of three product photos in a tinted container, named for their
 * category. `groups` is `[{ id, name, to, items: [product] }]`.
 */
export function FrequentlyBought({ title, groups = [], seeAllTo }) {
  const { storePath } = useStoreMode()
  const usable = groups.filter((g) => g.items.length)
  if (!usable.length) return null
  const thumbs = usable.flatMap((g) => g.items).slice(0, 3).map(firstImage).filter(Boolean)

  return (
    <Reveal as="section" aria-label={title} className="px-4">
      <h2 className={`${heading} mb-3`}>{title}</h2>
      <Rail rows={1} ariaLabel={title} auto={5000} cols="auto-cols-[88%] sm:auto-cols-[60%]">
        {usable.map((group) => (
          <Link
            key={group.id}
            to={group.to}
            className="block snap-start rounded-2xl bg-[#E4F1F6] p-1.5 pb-2 active:scale-[0.99]"
          >
            <span className="grid grid-cols-3 gap-1.5">
              {group.items.slice(0, 3).map((p) => {
                const src = firstImage(p)
                return (
                  <span key={p._id || p.id} className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white p-2">
                    {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" /> : null}
                  </span>
                )
              })}
            </span>
            <span className="mt-2 block text-center text-[14px] font-semibold text-wh-text">{group.name}</span>
          </Link>
        ))}
      </Rail>
      {seeAllTo ? (
        <Link
          to={storePath(seeAllTo)}
          className="mt-3 flex items-center justify-center gap-3 rounded-2xl bg-[#E4F1F6] px-4 py-2.5 text-[15px] font-semibold text-[#1E4A8A] active:scale-[0.99]"
        >
          {thumbs.length ? (
            <span className="flex -space-x-2">
              {thumbs.map((src) => (
                <img key={src} src={src} alt="" className="h-8 w-8 rounded-full border-2 border-white bg-white object-contain" />
              ))}
            </span>
          ) : null}
          See all products
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </Reveal>
  )
}

/** Tall bordered cards with a "Featured" tab notched into the top edge. */
export function FeaturedRail({ items = [] }) {
  if (!items.length) return null
  return (
    <Reveal as="section" aria-label="Featured this week" className="px-4">
      <h2 className={`${heading} mb-3`}>Featured this week</h2>
      <Rail rows={1} ariaLabel="Featured this week" auto={4200} cols="auto-cols-[30%] sm:auto-cols-[22%] lg:auto-cols-[160px]">
        {items.map((item) => {
          const art = mediaUrl(item.artUrl)
          const launch = item.style === "launch"
          return (
            <AppLink
              key={item._id || item.title}
              to={item.link}
              className={`wh-lift relative block aspect-[105/125] snap-start overflow-hidden rounded-2xl border-[3px] ${
                launch ? "border-[#E8A53A] bg-gradient-to-b from-[#D8342B] to-[#F6C15B]" : "border-[#2F6FD6] bg-[#EAF1FC]"
              }`}
            >
              {art ? (
                <img src={art} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              {/* The notched tab on the top edge. */}
              <span
                className={`absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-b-lg px-2.5 py-0.5 text-[10px] font-bold ${
                  launch ? "bg-[#FFF3D6] text-[#B8361E]" : "bg-white text-[#2F6FD6]"
                }`}
              >
                {item.badge || "Featured"}
              </span>
              <span
                className={`absolute inset-x-1.5 top-6 z-10 text-center text-[14px] font-bold leading-tight ${
                  launch || art ? "text-white drop-shadow" : "text-wh-text"
                }`}
              >
                {item.title}
              </span>
              {launch ? (
                <span className="wh-blink absolute inset-x-0 bottom-1.5 z-10 text-center text-[10px] font-bold text-white">
                  ✦ For You ✦
                </span>
              ) : null}
            </AppLink>
          )
        })}
      </Rail>
    </Reveal>
  )
}

/** A full-width campaign: copy on the left, art drifting on the right. */
export function CampaignBanner({ campaign }) {
  if (!campaign) return null
  const art = mediaUrl(campaign.artUrl)
  const brands = (campaign.poweredBy || []).filter((b) => b?.logoUrl)
  return (
    <Reveal as="section" aria-label={campaign.title} className="px-4">
      <AppLink
        to={campaign.link}
        className="relative block aspect-[2/1] overflow-hidden rounded-2xl shadow-sm"
        style={{ background: campaign.tint || "var(--wh-nav-2)" }}
      >
        {art ? (
          <img src={art} alt="" loading="lazy" className="wh-kenburns absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/35 via-black/10 to-transparent" />
        <span className="relative flex h-full w-[58%] flex-col justify-center gap-1 p-4">
          <span className="text-[20px] font-black leading-tight text-white drop-shadow">{campaign.title}</span>
          {campaign.subtitle ? <span className="text-[13px] text-white/90">{campaign.subtitle}</span> : null}
          {brands.length ? (
            <span className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold text-white/80">
              POWERED BY:
              {brands.map((b) => (
                <img key={b.logoUrl} src={mediaUrl(b.logoUrl)} alt={b.name || ""} className="h-4 w-auto" />
              ))}
            </span>
          ) : null}
          <span className="wh-sheen relative mt-2 w-fit overflow-hidden rounded-lg bg-white px-4 py-1.5 text-[14px] font-bold text-wh-text">
            {campaign.ctaText || "Shop now"}
          </span>
        </span>
      </AppLink>
    </Reveal>
  )
}

/** A titled grid of subcategory tiles, four across. */
export function CategoryGroup({ group }) {
  const { storePath } = useStoreMode()
  if (!group?.children?.length) return null
  return (
    <Reveal as="section" aria-label={group.title} className="px-4">
      <h2 className={`${heading} mb-3`}>{group.title}</h2>
      <div className="grid grid-cols-4 gap-x-2.5 gap-y-3">
        {group.children.map((child) => {
          const image = mediaUrl(child.image)
          const slug = child.name.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
          return (
            <Link key={child.id} to={storePath(`/category/${slug}`)} className="group block active:scale-95">
              <span className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-[#EEF4F8] p-1.5">
                {image ? (
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-110"
                  />
                ) : (
                  <span aria-hidden="true" className="text-[18px] font-black text-wh-muted">
                    {child.name.slice(0, 1)}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-center text-[11px] font-semibold leading-tight text-wh-text line-clamp-2">
                {child.name}
              </span>
            </Link>
          )
        })}
      </div>
    </Reveal>
  )
}
