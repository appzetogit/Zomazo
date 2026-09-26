/**
 * The Quick product card (QUICK_UI_SPEC.md, "Product card"): discount ribbon,
 * square image, delivery chip, 2-line name, pack size, then price + ADD.
 *
 * ADD turns into a "− qty +" stepper in the same 66×32 box (no layout shift)
 * and drives the real cart through useQuickCartLine.
 */
import { Clock, Minus, Plus } from "lucide-react"
import { Link } from "react-router-dom"
import { useStoreMode } from "@store/context/StoreModeContext"
import { ImagePlaceholder, isRealImage, percentOff } from "../ui"
import { useQuickEta } from "../useDeliveryEstimates"
import useQuickCartLine from "./useQuickCartLine"
import {
  cx,
  focusRing,
  formatMoney,
  productId,
  productImage,
  productMrp,
  productName,
  productPack,
  productPrice,
} from "./quickHelpers"

/** 66×32 control: ADD, the stepper, "Options", or a disabled "Out of stock". */
const BOX = "h-[32px] w-[66px] shrink-0 rounded-[6px] text-[13px] font-semibold"

function QuickAddControl({ product, name, to }) {
  const { qty, add, increase, decrease, inStock, hasOptions, atMax } = useQuickCartLine(product)

  if (!inStock) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${name} is out of stock`}
        className={cx(
          BOX,
          "border border-wh-border bg-[#F7F7F7] px-1 text-[9px] font-bold uppercase leading-[11px] tracking-tight text-wh-muted",
        )}
      >
        Out of stock
      </button>
    )
  }

  if (hasOptions) {
    return (
      <Link
        to={to}
        aria-label={`Choose options for ${name}`}
        className={cx(
          BOX,
          "inline-flex items-center justify-center border border-wh-brand-ink bg-wh-brand-50 text-[12px] text-wh-brand-ink transition-colors hover:bg-wh-brand hover:text-wh-text",
          focusRing,
        )}
      >
        Options
      </Link>
    )
  }

  if (qty > 0) {
    return (
      <div
        className={cx(BOX, "flex items-stretch overflow-hidden bg-wh-brand-ink text-white")}
        role="group"
        aria-label={`Quantity of ${name} in cart`}
      >
        <button
          type="button"
          onClick={decrease}
          aria-label={qty === 1 ? `Remove ${name} from cart` : `Decrease quantity of ${name}`}
          className={cx("flex w-[20px] items-center justify-center hover:bg-[#93400a]", focusRing)}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="flex flex-1 items-center justify-center tabular-nums" aria-live="polite">
          {qty}
        </span>
        <button
          type="button"
          onClick={increase}
          disabled={atMax}
          aria-label={`Increase quantity of ${name}`}
          className={cx(
            "flex w-[20px] items-center justify-center hover:bg-[#93400a] disabled:cursor-not-allowed disabled:opacity-50",
            focusRing,
          )}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={add}
      aria-label={`Add ${name} to cart`}
      className={cx(
        BOX,
        "border border-wh-brand-ink bg-wh-brand-50 text-wh-brand-ink transition-colors hover:bg-wh-brand hover:text-wh-text",
        focusRing,
      )}
    >
      ADD
    </button>
  )
}

export default function QuickProductCard({ product, etaMinutes }) {
  const { storePath } = useStoreMode()
  const zoneEta = useQuickEta()
  const { inStock } = useQuickCartLine(product)
  if (!product) return null

  const id = productId(product)
  const name = productName(product)
  const price = productPrice(product)
  const mrp = productMrp(product)
  const off = percentOff(price, mrp)
  const img = productImage(product)
  const pack = productPack(product)
  const to = storePath(`/product/${id}`)
  const eta = Math.round(Number(etaMinutes) > 0 ? Number(etaMinutes) : zoneEta)

  return (
    <div
      className={cx(
        "group relative flex min-h-[299px] flex-col rounded-[8px] border border-wh-border bg-wh-surface text-wh-text transition-shadow hover:shadow-md",
        !inStock && "opacity-60",
      )}
    >
      {/* The card body is one big link; the ADD control sits above it. */}
      <Link to={to} aria-label={name} className={cx("absolute inset-0 z-0 rounded-[8px]", focusRing)}>
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
          {eta} MINS
        </span>
        <p className="line-clamp-2 text-[13px] font-medium leading-[17px]">{name}</p>
        {pack ? <p className="text-[12px] leading-4 text-wh-muted">{pack}</p> : null}
        <div className="relative z-10 mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[14px] font-bold">₹{formatMoney(price)}</span>
            {mrp && mrp > price ? (
              <s className="text-[11px] text-wh-muted">₹{formatMoney(mrp)}</s>
            ) : null}
          </span>
          <QuickAddControl product={product} name={name} to={to} />
        </div>
      </div>
    </div>
  )
}

/** Same footprint as the card, for loading grids and rails. */
export function QuickProductCardSkeleton() {
  return (
    <div className="min-h-[299px] animate-pulse rounded-[8px] border border-wh-border bg-wh-surface p-3">
      <div className="aspect-square rounded-[6px] bg-[#F0F2F2]" />
      <div className="mt-3 h-3 w-1/3 rounded bg-[#F0F2F2]" />
      <div className="mt-2 h-3 w-5/6 rounded bg-[#F0F2F2]" />
      <div className="mt-2 h-3 w-2/3 rounded bg-[#F0F2F2]" />
      <div className="mt-4 flex items-center justify-between">
        <div className="h-4 w-12 rounded bg-[#F0F2F2]" />
        <div className="h-[32px] w-[66px] rounded-[6px] bg-[#F0F2F2]" />
      </div>
    </div>
  )
}
