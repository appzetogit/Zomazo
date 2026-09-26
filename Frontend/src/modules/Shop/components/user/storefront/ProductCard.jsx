import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Star } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { ImagePlaceholder, isRealImage, percentOff } from "../desktop/ui"
import { mediaUrl } from "../desktop/desktopCart"

/**
 * The storefront product card (MOBILE_UI_SPEC.md), at the reference's
 * proportions: a 4:5 image on a tinted panel, then the name, the price against
 * a struck MRP, a discount pill, the rating, and a full-width outlined action.
 *
 * The whole card links to the product; the action is a button on top of it, so
 * `onAction` must stop the click from reaching the link.
 */
export default function ProductCard({
  product,
  actionLabel = "Add to cart",
  onAction,
  disabled = false,
  badge = null,
  footNote = null,
}) {
  const { storePath } = useStoreMode()
  const ref = useRef(null)
  const id = product?._id || product?.id

  // Every photo the product has, so the card can cycle through them.
  //
  // `image` often arrives already resolved to an absolute URL while `images`
  // stay relative, so the same file appears under two spellings. Comparing
  // paths keeps one copy — otherwise a card spends half its cycle fading one
  // photo into itself, which reads as nothing happening.
  const gallery = useMemo(() => {
    const raw = [product?.image, ...(Array.isArray(product?.images) ? product.images : [])]
    const seen = new Set()
    const urls = []
    for (const entry of raw) {
      const url = mediaUrl(typeof entry === "string" ? entry : entry?.url)
      if (!isRealImage(url)) continue
      let key = url
      try {
        key = new URL(url, window.location.origin).pathname
      } catch {
        /* not a parseable URL; compare the raw string */
      }
      if (seen.has(key)) continue
      seen.add(key)
      urls.push(url)
    }
    return urls.slice(0, 5)
  }, [product])

  const [frame, setFrame] = useState(0)

  // Cycle only while the card is on screen, and never when the visitor has
  // asked for less motion — an animation nobody is looking at is just battery.
  useEffect(() => {
    if (gallery.length < 2) return undefined
    const el = ref.current
    if (!el) return undefined
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    if (still) return undefined

    let timer = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => setFrame((f) => (f + 1) % gallery.length), 2600)
    }
    const stop = () => {
      clearInterval(timer)
      timer = null
    }
    if (typeof IntersectionObserver === "undefined") {
      start()
      return stop
    }
    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0.35 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [gallery.length])

  const price = Number(product?.displayPrice ?? product?.price ?? 0)
  const mrp = Number(product?.mrp ?? 0)
  const off = percentOff(price, mrp)
  const rating = Number(product?.rating) > 0 ? Number(product.rating) : null
  const ratingCount = Number(product?.ratingCount ?? product?.totalRatings) || 0

  return (
    <article
      ref={ref}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-wh-border bg-wh-surface transition-shadow duration-300 hover:shadow-lg"
    >
      <Link to={storePath(`/product/${id}`)} className="flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-wh-brand">
        <div className="group relative aspect-[4/5] w-full overflow-hidden rounded-t-2xl bg-[#F7F7F7]">
          {gallery.length ? (
            gallery.map((url, i) => (
              <img
                key={url}
                src={url}
                alt={i === 0 ? product?.name || "Product" : ""}
                aria-hidden={i === 0 ? undefined : "true"}
                loading={i === 0 ? "lazy" : "eager"}
                className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ease-out group-hover:scale-105 ${
                  i === frame ? "opacity-100" : "opacity-0"
                }`}
              />
            ))
          ) : (
            <ImagePlaceholder name={product?.name} />
          )}
          {/* Which photo is showing, when there is more than one. */}
          {gallery.length > 1 ? (
            <span aria-hidden="true" className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
              {gallery.map((url, i) => (
                <span
                  key={url}
                  className={`h-1 rounded-full bg-white transition-all duration-300 ${
                    i === frame ? "w-3 opacity-95" : "w-1 opacity-60"
                  }`}
                />
              ))}
            </span>
          ) : null}
          {badge}
        </div>

        <div className="flex flex-1 flex-col justify-between space-y-1 p-2 sm:p-2.5">
          <h3 className="line-clamp-2 text-[12px] font-semibold uppercase leading-snug tracking-tight text-wh-text sm:text-[13px]">
            {product?.name}
          </h3>

          {product?.packSize ? (
            <p className="text-[11px] text-wh-muted">{product.packSize}</p>
          ) : null}

          <div className="flex flex-wrap items-baseline gap-x-1.5">
            {mrp > price ? (
              <span className="text-[11px] text-wh-muted line-through">₹{mrp.toLocaleString("en-IN")}</span>
            ) : null}
            <span className="text-[14px] font-bold text-wh-text">₹{price.toLocaleString("en-IN")}</span>
          </div>

          {off > 0 ? (
            <span className="inline-block w-fit rounded bg-wh-success px-1.5 py-0.5 text-[10px] font-black text-white">
              {off}% OFF
            </span>
          ) : null}

          {rating ? (
            <div className="flex items-center gap-1">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className={`h-3 w-3 ${i < Math.round(rating) ? "fill-amber-500 text-amber-500" : "text-gray-300"}`}
                    aria-hidden="true"
                  />
                ))}
              </div>
              {ratingCount > 0 ? <span className="text-[10px] text-wh-muted">({ratingCount})</span> : null}
            </div>
          ) : null}

          {footNote}
        </div>
      </Link>

      {onAction ? (
        <div className="px-2 pb-2 sm:px-2.5 sm:pb-2.5">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction(product)
            }}
            className="w-full rounded-full border-[0.8px] border-wh-text px-3 py-1.5 text-[12px] font-medium text-wh-text transition-colors hover:bg-wh-brand hover:border-wh-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLabel}
          </button>
        </div>
      ) : null}
    </article>
  )
}
