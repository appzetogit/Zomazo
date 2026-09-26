/**
 * The Quick product card, from the Shop's Quick UI (QuickProductCard.jsx):
 * discount ribbon, square image, delivery chip, two-line name, pack size, then
 * price and ADD. ADD becomes a "- qty +" stepper in the same 66x32 box.
 *
 * Differences for quick commerce: the card names the store (one order = one
 * store), and a product with variants opens its store, where they are chosen.
 */
import { useRef } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, ChevronRight, Clock, Minus, Plus } from "lucide-react"
import { useQuickCart } from "../context/QuickCartContext"
import {
  ImagePlaceholder,
  cx,
  focusRing,
  formatMoney,
  isRealImage,
  percentOff,
  productHasOptions,
  productId,
  productImage,
  productMaxQty,
  productMrp,
  productName,
  productPack,
  productPrice,
  productStock,
  productStore,
} from "../helpers"

const BOX = "h-[32px] w-[66px] shrink-0 rounded-[6px] text-[13px] font-semibold"

function AddControl({ product, name, storeTo, store }) {
  const { getQty, setQty, addProduct } = useQuickCart()
  const id = productId(product)
  const qty = getQty(id)
  const inStock = productStock(product) !== 0
  const max = productMaxQty(product)
  const atMax = max != null && qty >= max

  if (!inStock) {
    return (
      <button type="button" disabled aria-label={`${name} is out of stock`}
        className={cx(BOX, "border border-wh-border bg-[#F7F7F7] px-1 text-[9px] font-bold uppercase leading-[11px] tracking-tight text-wh-muted")}>
        Out of stock
      </button>
    )
  }
  if (productHasOptions(product)) {
    return (
      <Link to={storeTo} aria-label={`Choose options for ${name}`}
        className={cx(BOX, "inline-flex items-center justify-center border border-wh-brand-ink bg-wh-brand-50 text-[12px] text-wh-brand-ink transition-colors hover:bg-wh-brand hover:text-wh-text", focusRing)}>
        Options
      </Link>
    )
  }
  if (qty > 0) {
    return (
      <div className={cx(BOX, "flex items-stretch overflow-hidden bg-wh-brand-ink text-white")} role="group" aria-label={`Quantity of ${name} in cart`}>
        <button type="button" onClick={() => setQty(id, qty - 1)}
          aria-label={qty === 1 ? `Remove ${name} from cart` : `Decrease quantity of ${name}`}
          className={cx("flex w-[20px] items-center justify-center hover:bg-[#93400a]", focusRing)}>
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="flex flex-1 items-center justify-center tabular-nums" aria-live="polite">{qty}</span>
        <button type="button" onClick={() => addProduct(product, store)} disabled={atMax} aria-label={`Increase quantity of ${name}`}
          className={cx("flex w-[20px] items-center justify-center hover:bg-[#93400a] disabled:cursor-not-allowed disabled:opacity-50", focusRing)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    )
  }
  return (
    <button type="button" onClick={() => addProduct(product, store)} aria-label={`Add ${name} to cart`}
      className={cx(BOX, "border border-wh-brand-ink bg-wh-brand-50 text-wh-brand-ink transition-colors hover:bg-wh-brand hover:text-wh-text", focusRing)}>
      ADD
    </button>
  )
}

/**
 * @param store  the store the product belongs to, when the list does not say
 *               (a store's own menu); search results carry it themselves.
 */
export default function ProductCard({ product, etaMinutes = 10, store, showStore = true }) {
  if (!product) return null
  const name = productName(product)
  const price = productPrice(product)
  const mrp = productMrp(product)
  const off = percentOff(price, mrp)
  const img = productImage(product)
  const pack = productPack(product)
  const owner = productStore(product, store)
  const storeTo = `/quick/store/${owner.id}`
  const inStock = productStock(product) !== 0

  return (
    <div className={cx("group relative flex min-h-[299px] flex-col rounded-[8px] border border-wh-border bg-wh-surface text-wh-text transition-shadow hover:shadow-md", !inStock && "opacity-60")}>
      {/* There is no product page in quick commerce: the card opens its store. */}
      <Link to={storeTo} aria-label={`${name} at ${owner.name || "its store"}`} className={cx("absolute inset-0 z-0 rounded-[8px]", focusRing)}>
        <span className="sr-only">{name}</span>
      </Link>
      {off ? (
        <span className="absolute left-0 top-2 z-10 rounded-r-[4px] bg-wh-deal px-1.5 py-[3px] text-[9px] font-extrabold uppercase leading-[11px] text-white">
          {off}% OFF
        </span>
      ) : null}
      <div className="px-3 pt-3">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[6px] bg-[#F7F7F7]">
          {isRealImage(img) ? (
            <img src={img} alt={name} loading="lazy" className="h-full w-full object-contain mix-blend-multiply" />
          ) : (
            <ImagePlaceholder name={name} />
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 pb-3 pt-2">
        <span className="inline-flex w-fit items-center gap-1 rounded-[4px] bg-[#F0F2F2] px-1.5 py-[2px] text-[10px] font-bold uppercase leading-[12px] text-wh-success">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {Math.round(Number(product?.seller?.estimatedDeliveryTimeMinutes) || etaMinutes)} MINS
        </span>
        <p className="line-clamp-2 text-[13px] font-medium leading-[17px]">{name}</p>
        {pack ? <p className="text-[12px] leading-4 text-wh-muted">{pack}</p> : null}
        {showStore && owner.name ? <p className="truncate text-[11px] leading-4 text-wh-muted">from {owner.name}</p> : null}
        <div className="relative z-10 mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[14px] font-bold">₹{formatMoney(price)}</span>
            {mrp && mrp > price ? <s className="text-[11px] text-wh-muted">₹{formatMoney(mrp)}</s> : null}
          </span>
          <AddControl product={product} name={name} storeTo={storeTo} store={store} />
        </div>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="min-h-[299px] animate-pulse rounded-[8px] border border-wh-border bg-wh-surface p-3">
      <div className="aspect-square rounded-[6px] bg-[#F0F2F2]" />
      <div className="mt-3 h-3 w-1/3 rounded bg-[#F0F2F2]" />
      <div className="mt-2 h-3 w-5/6 rounded bg-[#F0F2F2]" />
      <div className="mt-4 flex items-center justify-between">
        <div className="h-4 w-12 rounded bg-[#F0F2F2]" />
        <div className="h-[32px] w-[66px] rounded-[6px] bg-[#F0F2F2]" />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- lists */

export const QUICK_GRID =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:max-wide:grid-cols-5 wide:grid-cols-6"

export function ProductGrid({ products = [], etaMinutes, store, showStore }) {
  return (
    <div className={QUICK_GRID}>
      {products.map((p) => (
        <ProductCard key={productId(p)} product={p} etaMinutes={etaMinutes} store={store} showStore={showStore} />
      ))}
    </div>
  )
}

export function GridSkeleton({ count = 12 }) {
  return (
    <div className={QUICK_GRID} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => <ProductCardSkeleton key={i} />)}
    </div>
  )
}

export function SectionHead({ title, seeAllTo, seeAllLabel = "see all" }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[19px] font-black leading-6 tracking-tight lg:font-bold">{title}</h2>
      {seeAllTo ? (
        <Link to={seeAllTo} className={cx("shrink-0 text-[13px] font-medium text-wh-link hover:text-wh-link-hover hover:underline", focusRing)}>
          {seeAllLabel}
        </Link>
      ) : null}
    </div>
  )
}

/** A horizontal row of cards; needs at least `min` products to earn a row. */
export function ProductRail({ title, products = [], seeAllTo, etaMinutes, loading = false, min = 4 }) {
  const rowRef = useRef(null)
  const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.9, behavior: "smooth" })

  if (loading) {
    return (
      <section className="rounded-[8px] bg-wh-surface px-4 py-4 lg:px-5">
        <SectionHead title={title} />
        <div className="flex gap-3 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="w-[160px] shrink-0 lg:w-[175px]"><ProductCardSkeleton /></div>)}
        </div>
      </section>
    )
  }
  if (products.length < min) return null
  return (
    <section className="rounded-[8px] bg-wh-surface px-4 py-4 text-wh-text lg:px-5">
      <SectionHead title={title} seeAllTo={seeAllTo} />
      <div className="relative">
        <div ref={rowRef} className="flex gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {products.map((p) => (
            <div key={productId(p)} className="w-[160px] shrink-0 lg:w-[175px]">
              <ProductCard product={p} etaMinutes={etaMinutes} />
            </div>
          ))}
        </div>
        {products.length > 6 ? (
          <>
            <button type="button" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}
              className={cx("absolute -left-3 top-[100px] hidden h-9 w-9 items-center justify-center rounded-full border border-wh-border bg-wh-surface shadow-md lg:flex", focusRing)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}
              className={cx("absolute -right-3 top-[100px] hidden h-9 w-9 items-center justify-center rounded-full border border-wh-border bg-wh-surface shadow-md lg:flex", focusRing)}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}
