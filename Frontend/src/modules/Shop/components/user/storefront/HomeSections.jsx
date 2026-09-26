import { Link } from "react-router-dom"
import { ArrowRight, BadgeCheck, Gift, RotateCcw, Truck } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { ImagePlaceholder, isRealImage } from "../desktop/ui"
import { mediaUrl } from "../desktop/desktopCart"
import ProductCard from "./ProductCard"
import Rail from "./Rail"
import Reveal from "./Reveal"
import SectionHeading from "./SectionHeading"

/**
 * The home page's sections, in the reference's order and proportions
 * (MOBILE_UI_SPEC.md). Each one takes data the page already loads; none of
 * them fetch.
 */

const TRUST = [
  { icon: BadgeCheck, title: "Every seller checked", note: "Approved stores only" },
  { icon: Gift, title: "Gift-ready packing", note: "Notes and boxes" },
  { icon: Truck, title: "Delivered across India", note: "Courier or 10-minute rider" },
  { icon: RotateCcw, title: "Easy returns", note: "Per our returns policy" },
]

/** The four promises under the hero: icon chip, title, one-line note. */
export function TrustStrip() {
  return (
    <Reveal
      as="section"
      aria-label="Why shop with us"
      className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4"
    >
      {TRUST.map(({ icon: Icon, title, note }) => (
        <div
          key={title}
          className="wh-lift flex items-center gap-2 rounded-2xl border border-wh-border bg-wh-surface p-2.5 hover:shadow-md sm:gap-3 sm:p-3"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wh-brand-50 text-wh-brand-ink">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-bold text-wh-text sm:text-[13px]">{title}</span>
            <span className="block truncate text-[10px] text-wh-muted sm:text-[11px]">{note}</span>
          </span>
        </div>
      ))}
    </Reveal>
  )
}

/** The scrolling announcement strip. The text is duplicated so the loop seams. */
export function Marquee({ items = [] }) {
  if (!items.length) return null
  const run = [...items, ...items]
  return (
    <section aria-label="Announcements" className="overflow-hidden rounded-2xl bg-wh-nav py-2">
      <div className="wh-marquee-track flex w-max items-center gap-8 whitespace-nowrap px-4">
        {run.map((text, i) => (
          <span key={i} className="flex items-center gap-2 text-[12px] font-semibold text-white/90">
            <span aria-hidden="true" className="wh-blink text-wh-brand">
              ★
            </span>
            {text}
          </span>
        ))}
      </div>
    </section>
  )
}

/** Category tiles: photo, dark gradient, name and an "Explore" cue. */
export function CollectionTiles({ title, subtitle, tiles = [], seeAllTo }) {
  const { storePath } = useStoreMode()
  if (!tiles.length) return null

  return (
    <Reveal as="section" aria-label={title}>
      <SectionHeading title={title} subtitle={subtitle} />
      {/* The collections drift along on their own, and stop the moment you
          reach for one. */}
      <Rail
        rows={1}
        ariaLabel={title}
        auto={3800}
        cols="auto-cols-[40vw] sm:auto-cols-[26vw] lg:auto-cols-[190px]"
      >
        {tiles.map((tile) => {
          const image = mediaUrl(tile.image)
          return (
            <Link
              key={tile.id}
              to={tile.to}
              className="wh-lift wh-sheen group relative block aspect-[4/5] snap-start overflow-hidden rounded-2xl bg-[#F7F7F7] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-wh-brand"
            >
              {isRealImage(image) ? (
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                />
              ) : (
                <ImagePlaceholder name={tile.label} />
              )}
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <span className="absolute inset-x-2 bottom-2">
                <span className="block truncate text-[12px] font-bold text-white drop-shadow sm:text-[13px]">{tile.label}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-wh-brand">
                  Explore <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </span>
            </Link>
          )
        })}
      </Rail>
      {seeAllTo ? (
        <div className="mt-4 text-center">
          <Link
            to={storePath(seeAllTo)}
            className="inline-flex items-center gap-2 rounded-full bg-wh-nav px-5 py-2.5 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-wh-nav-2"
          >
            View more <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </Reveal>
  )
}

/** A titled rail of product cards. */
export function ProductRailSection({ title, subtitle, products = [], onAdd, minimum = 4, auto = 0 }) {
  if (products.length < minimum) return null

  return (
    <Reveal as="section" aria-label={title}>
      <SectionHeading title={title} subtitle={subtitle} />
      <Rail ariaLabel={title} auto={auto}>
        {products.map((product) => (
          <div key={product._id || product.id} className="snap-start">
            <ProductCard product={product} onAction={onAdd} />
          </div>
        ))}
      </Rail>
    </Reveal>
  )
}

/** The dark band that breaks up the page, with a headline and a call to action. */
export function FeatureBand({ title, subtitle, ctaLabel, ctaTo }) {
  return (
    <Reveal
      as="section"
      className="overflow-hidden rounded-2xl bg-gradient-to-br from-wh-nav via-wh-nav-2 to-wh-nav-3 px-5 py-8 text-center sm:py-10"
    >
      <h2 className="font-display text-[24px] font-semibold leading-tight text-white sm:text-[32px]">{title}</h2>
      {subtitle ? <p className="mx-auto mt-2 max-w-xl text-[12px] text-white/75 sm:text-[14px]">{subtitle}</p> : null}
      {ctaTo ? (
        <Link
          to={ctaTo}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-wh-brand px-5 py-2.5 text-[13px] font-bold text-wh-text hover:bg-wh-brand-600"
        >
          {ctaLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </Reveal>
  )
}

/** Curated style lookbooks and seasonal trend moodboards */
export function CuratedEditsSection() {
  const { storePath } = useStoreMode()

  const edits = [
    {
      id: "linen-casuals",
      badge: "Pure Linens",
      title: "The Linen Studio",
      desc: "Breathable natural weaves & relaxed shirts",
      image: "/uploads/seed/banners/hero-the-linen-cotton-stu.webp",
      to: "/category/shirts",
      accent: "from-stone-950/85 via-black/40 to-transparent",
    },
    {
      id: "streetwear-oversized",
      badge: "New Season Drop",
      title: "Streetwear & Graphic",
      desc: "Heavyweight 240 GSM drop-shoulder tees & cargos",
      image: "/uploads/seed/banners/hero-autumn-winter-contem.webp",
      to: "/category/t-shirts",
      accent: "from-slate-950/85 via-black/40 to-transparent",
    },
    {
      id: "artisanal-festive",
      badge: "Heritage Royal",
      title: "Festive & Ethnic Kurtas",
      desc: "Chanderi silks, handloom weaves & royal anarkalis",
      image: "/uploads/quick/fashion/banners/banner-3-festive-ethnic.webp",
      to: "/category/kurtas",
      accent: "from-rose-950/85 via-black/40 to-transparent",
    },
    {
      id: "indigo-denim",
      badge: "Timeless Essentials",
      title: "Indigo Denim Studio",
      desc: "Raw selvedge slim-tapered jeans & trucker jackets",
      image: "/uploads/seed/banners/hero-timeless-indigo-deni.webp",
      to: "/category/jeans",
      accent: "from-blue-950/85 via-black/40 to-transparent",
    },
  ]

  return (
    <Reveal as="section" aria-label="Curated Fashion Edits">
      <SectionHeading
        title="Curated Style Edits"
        subtitle="Handpicked seasonal moodboards & trending wardrobes"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {edits.map((item) => (
          <Link
            key={item.id}
            to={storePath(item.to)}
            className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-neutral-900 shadow-md hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
          >
            <img
              src={item.image}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            />
            <div className={`absolute inset-0 bg-gradient-to-t ${item.accent}`} />

            <div className="absolute inset-0 p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <span className="inline-block rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white border border-white/30">
                  {item.badge}
                </span>
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug drop-shadow-md">
                  {item.title}
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-white/80 line-clamp-2">
                  {item.desc}
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs font-bold text-white group-hover:text-wh-brand transition-colors">
                  <span>Shop The Edit</span>
                  <ArrowRight className="h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Reveal>
  )
}

/** Featured verified fashion boutique brands */
export function BoutiqueStoresSection() {
  const { storePath } = useStoreMode()

  const boutiques = [
    {
      id: "urban-thread",
      name: "Urban Thread",
      slug: "urban-thread",
      specialty: "Contemporary Streetwear & Oversized Fits",
      rating: "4.9",
      location: "Bengaluru Central",
      badge: "Top Rated Boutique",
      logo: "/uploads/seed/categories/t-shirts.webp",
    },
    {
      id: "kora-basics",
      name: "Kora Basics",
      slug: "kora-basics",
      specialty: "Pure Linen & Organic Heavyweight Cottons",
      rating: "4.8",
      location: "Indore",
      badge: "Sustainable Craft",
      logo: "/uploads/seed/categories/shirts.webp",
    },
    {
      id: "vogue-craft",
      name: "Vogue Craft",
      slug: "vogue-craft",
      specialty: "Chanderi Silks & Artisanal Ethnic Wear",
      rating: "4.9",
      location: "Jaipur",
      badge: "Heritage Handloom",
      logo: "/uploads/seed/categories/kurtas.webp",
    },
  ]

  return (
    <Reveal as="section" aria-label="Verified Fashion Boutiques">
      <SectionHeading
        title="Featured Fashion Boutiques"
        subtitle="Discover verified independent fashion designers and apparel houses"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {boutiques.map((b) => (
          <Link
            key={b.id}
            to={storePath(`/sellers/${b.slug}`)}
            className="group relative rounded-2xl border border-wh-border bg-wh-surface p-5 hover:border-wh-brand/40 hover:shadow-lg transition-all flex flex-col justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 shrink-0 rounded-2xl overflow-hidden bg-neutral-100 border border-wh-border">
                <img src={b.logo} alt={b.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-bold text-wh-text truncate">{b.name}</h4>
                  <span className="shrink-0 flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600">
                    ★ {b.rating}
                  </span>
                </div>
                <p className="text-xs text-wh-muted mt-0.5 truncate">{b.specialty}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {b.badge}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-wh-border/60 flex items-center justify-between text-xs font-semibold text-wh-brand group-hover:text-wh-brand-600">
              <span>Visit Boutique Storefront</span>
              <ArrowRight className="h-3.5 w-3.5 transform group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>
    </Reveal>
  )
}

