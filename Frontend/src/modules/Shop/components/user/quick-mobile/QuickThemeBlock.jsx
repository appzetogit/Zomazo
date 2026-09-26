import { ChevronRight } from "lucide-react"
import { mediaUrl } from "../desktop/desktopCart"
import AppLink from "./AppLink"

/**
 * Everything under the tabs that belongs to the chosen theme
 * (QUICK_MOBILE_SPEC.md §1): the background art, "Powered by" marks, three
 * promo tiles, the rewards banner and the offer strip.
 *
 * Keyed by the theme's slug, so switching tabs remounts it and the entrance
 * animation plays — the block cross-fades rather than jumping.
 */

function PoweredBy({ brands = [] }) {
  const real = brands.filter((b) => b?.logoUrl)
  if (!real.length) return null
  return (
    <div className="flex items-center justify-center gap-2 pb-3">
      <span className="text-[13px] font-black tracking-wide text-[#3E6B3A]">POWERED BY:</span>
      {real.map((b) => (
        <img
          key={b.logoUrl}
          src={mediaUrl(b.logoUrl)}
          alt={b.name || ""}
          className="h-10 w-10 rounded-full bg-white object-contain p-0.5 shadow-sm"
        />
      ))}
    </div>
  )
}

function PromoTiles({ tiles = [] }) {
  if (!tiles.length) return null
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {tiles.slice(0, 3).map((tile, i) => {
        const image = mediaUrl(tile.imageUrl)
        return (
          <AppLink
            key={`${tile.title}-${i}`}
            to={tile.link}
            className="group relative flex aspect-[106/102] flex-col overflow-hidden rounded-xl bg-gradient-to-b from-white/80 to-white/40 p-2 shadow-sm ring-1 ring-black/5 backdrop-blur-[2px] transition-transform active:scale-95"
          >
            <span className="text-center text-[13px] font-bold leading-tight text-wh-text">{tile.title}</span>
            <span className="relative mt-1.5 flex min-h-0 flex-1 items-end justify-center">
              {image ? (
                // Photos fill the tile under the title; the slow zoom keeps the row alive.
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  // Out of step with each other, so the row breathes rather than marches.
                  style={{ animationDelay: `${i * 0.6}s` }}
                  className="wh-kenburns h-full w-full rounded-lg object-cover object-top shadow-sm transition-transform duration-300 group-active:scale-95"
                />
              ) : (
                <span aria-hidden="true" className="mb-1 h-10 w-10 rounded-full bg-wh-brand/20" />
              )}
            </span>
          </AppLink>
        )
      })}
    </div>
  )
}

function RewardsBanner({ rewards }) {
  if (!rewards?.title) return null
  const thumbs = (rewards.thumbs || []).map(mediaUrl).filter(Boolean)
  return (
    <AppLink
      to={rewards.link}
      className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-[#9DB8A0] to-[#B8CDBA] px-2.5 py-2 shadow-sm active:scale-[0.99]"
    >
      {thumbs.length ? (
        <span className="flex shrink-0 -space-x-3">
          {thumbs.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              style={{ animationDelay: `${i * 0.4}s` }}
              className="wh-shuffle h-11 w-11 rounded-full border-2 border-white bg-white object-cover shadow"
            />
          ))}
        </span>
      ) : (
        <span aria-hidden="true" className="wh-shuffle flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[20px] shadow">
          🎁
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-bold text-[#1F3A24]">{rewards.title}</span>
        {rewards.subtitle ? (
          <span className="block truncate text-[12px] text-[#2F4F33]">{rewards.subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-6 w-6 shrink-0 text-[#1F3A24]" aria-hidden="true" />
    </AppLink>
  )
}

function OfferStrip({ offer }) {
  if (!offer?.text) return null
  return (
    <AppLink
      to={offer.link}
      className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-white/60 px-3 py-2 text-center text-[13px] font-semibold text-wh-text"
    >
      <span className="min-w-0 truncate">{offer.text}</span>
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#B79A6B] text-[11px] text-white">
        →
      </span>
    </AppLink>
  )
}

export default function QuickThemeBlock({ theme }) {
  if (!theme) return null
  const background = mediaUrl(theme.backgroundUrl)

  return (
    <section
      key={theme.slug}
      aria-label={theme.label}
      className="wh-reveal is-visible relative overflow-hidden bg-wh-brand-50 px-4 pb-4 pt-4"
    >
      {background ? (
        <img
          src={background}
          alt=""
          aria-hidden="true"
          className="wh-kenburns pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
        />
      ) : (
        // Without art, a quiet dotted texture keeps the block from reading as blank.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle,rgba(0,0,0,0.08)_1px,transparent_1.5px)] [background-size:18px_18px]"
        />
      )}
      <div className="relative">
        <PoweredBy brands={theme.poweredBy} />
        <PromoTiles tiles={theme.promoTiles} />
        <RewardsBanner rewards={theme.rewards} />
        <OfferStrip offer={theme.offerStrip} />
      </div>
    </section>
  )
}
