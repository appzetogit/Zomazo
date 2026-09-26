/**
 * Desktop (lg+) cart subtotal card (DESKTOP_THEME.md). Presentation only: the
 * Cart page passes its own totals, labels and handlers (address sheet,
 * payment sheet, place order) so checkout behaves exactly as on mobile.
 */
import { MapPin } from "lucide-react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { CtaButton, DeliveryPromise } from "./ui"

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CartSubtotalCard({
  itemCount,
  subtotal,
  finalPayable,
  savings,
  addressLabel,
  addressText,
  onChangeAddress,
  paymentLabel,
  onChangePayment,
  onProceed,
  proceedDisabled,
  proceedLabel,
}) {
  const { isQuick } = useStoreMode()
  return (
    <section aria-label="Order subtotal" className="rounded-[8px] bg-wh-surface p-5 text-[14px] leading-5 text-wh-text">
      <p className="text-[18px]">
        Subtotal ({itemCount} item{itemCount === 1 ? "" : "s"}): <span className="font-bold">{money(subtotal)}</span>
      </p>
      {savings > 0 && <p className="mt-1 text-[13px] text-wh-success">You save {money(savings)} on this order</p>}
      <DeliveryPromise mode={isQuick ? "quick" : "shop"} className="mt-1" />

      <button
        type="button"
        onClick={onChangeAddress}
        className="mt-3 flex w-full items-start gap-1.5 rounded-[8px] text-left text-[13px] focus-visible:outline-2 focus-visible:outline-wh-brand"
      >
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-wh-muted" aria-hidden="true" />
        <span className="min-w-0">
          Deliver to <span className="font-bold">{addressLabel}</span>
          {addressText ? <span className="block truncate text-wh-muted">{addressText}</span> : null}
          <span className="text-wh-link hover:text-wh-link-hover hover:underline">Change</span>
        </span>
      </button>

      <button
        type="button"
        onClick={onChangePayment}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-[8px] border border-wh-border px-3 py-2 text-left text-[13px] hover:bg-[#F7FAFA] focus-visible:outline-2 focus-visible:outline-wh-brand"
      >
        <span className="min-w-0 truncate">Pay with <span className="font-bold">{paymentLabel}</span></span>
        <span className="shrink-0 text-wh-link">Change</span>
      </button>

      <p className="mt-3 flex justify-between text-[14px]">
        <span>Order total</span>
        <span className="font-bold">{money(finalPayable)}</span>
      </p>

      <CtaButton className="mt-3 h-[38px] text-[14px]" onClick={onProceed} disabled={proceedDisabled}>
        {proceedLabel}
      </CtaButton>
    </section>
  )
}
