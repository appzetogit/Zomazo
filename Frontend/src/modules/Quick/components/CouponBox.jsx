/**
 * Promo codes at checkout: type a code, or pick one from the coupons this store
 * accepts. The server decides -- the code is sent with /qc/orders/calculate and
 * the bill that comes back says whether it applied (pricing.appliedCoupon).
 * This box only collects the code and explains a refusal.
 */
import { useEffect, useState } from "react"
import { BadgePercent, ChevronDown, ChevronUp, Loader2, TicketPercent, X } from "lucide-react"
import { quickAPI } from "../api"
import { cx, focusRing, formatMoney } from "../helpers"

const offerLine = (o) => {
  const parts = []
  if (o.discountType === "percentage" && Number(o.maxDiscount)) parts.push(`up to ₹${formatMoney(o.maxDiscount)}`)
  if (Number(o.minOrderValue)) parts.push(`on orders above ₹${formatMoney(o.minOrderValue)}`)
  if (o.isFirstOrderOnly || o.customerScope === "first-time") parts.push("first order only")
  if (o.endDate) parts.push(`till ${new Date(o.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`)
  return parts.join(" · ")
}

/** Why a code the server did not apply was refused, as far as the list can tell. */
function couponRefusal(code, offers, subtotal) {
  const offer = offers.find((o) => String(o.couponCode || "").toUpperCase() === code)
  // The list leaves out coupons this customer has used up or no longer qualifies for.
  if (!offer) return `${code} is not valid for this store, or you have already used it.`
  const min = Number(offer.minOrderValue) || 0
  if (min > subtotal) return `Add items worth ₹${formatMoney(min - subtotal)} more to use ${code}.`
  return `${code} cannot be used on this order.`
}

/**
 * @param applied  pricing.appliedCoupon from the last quote ({ code, discount })
 * @param refused  a code the last quote was asked for and did not apply
 * @param pending  a quote with a new code is on its way
 */
export default function CouponBox({ storeId, subtotal, applied, refused, pending, onApply, onRemove }) {
  const [code, setCode] = useState("")
  const [offers, setOffers] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!storeId) return undefined
    let cancelled = false
    quickAPI
      .offers(storeId)
      .then((list) => !cancelled && setOffers(list.filter((o) => o.couponCode && o.showInCart !== false)))
      .catch(() => !cancelled && setOffers([]))
    return () => {
      cancelled = true
    }
  }, [storeId])

  const submit = (e) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (c) onApply(c)
  }

  if (applied) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-wh-success bg-[#E6F4EA] p-3">
        <BadgePercent className="h-5 w-5 shrink-0 text-wh-success" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-wh-text">{applied.code} applied</span>
          <span className="block text-[12px] text-wh-success">You save ₹{formatMoney(applied.discount)} on this order</span>
        </span>
        <button type="button" onClick={onRemove} aria-label={`Remove coupon ${applied.code}`}
          className={cx("rounded-full p-1.5 text-wh-muted hover:bg-black/5", focusRing)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const available = offers || []
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Coupon code</span>
          <TicketPercent className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wh-muted" aria-hidden="true" />
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter coupon code" autoCapitalize="characters"
            className="h-10 w-full rounded-[8px] border border-wh-border pl-9 pr-3 text-[14px] uppercase outline-none placeholder:normal-case focus:border-wh-brand-ink" />
        </label>
        <button type="submit" disabled={!code.trim() || pending}
          className={cx("flex h-10 min-w-[72px] items-center justify-center rounded-[8px] border border-wh-brand-ink px-4 text-[14px] font-bold text-wh-brand-ink disabled:opacity-50", focusRing)}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Checking" /> : "Apply"}
        </button>
      </form>
      {refused ? <p role="alert" className="text-[12px] font-semibold text-wh-deal">{couponRefusal(refused, offers || [], subtotal)}</p> : null}

      {available.length ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className={cx("flex items-center justify-between text-[13px] font-semibold text-wh-link", focusRing)}>
          View available coupons ({available.length})
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      ) : offers === null ? null : (
        <p className="text-[12px] text-wh-muted">No coupons for this store right now.</p>
      )}

      {open ? (
        <ul className="flex flex-col gap-2">
          {available.map((o) => {
            const short = Math.max(0, (Number(o.minOrderValue) || 0) - subtotal)
            return (
              <li key={o.id} className="flex items-start gap-3 rounded-[10px] border border-wh-border p-3">
                <BadgePercent className="mt-0.5 h-5 w-5 shrink-0 text-wh-brand-ink" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-wh-text">{o.title}</span>
                  <span className="mt-0.5 inline-block rounded border border-dashed border-wh-brand-ink px-1.5 text-[12px] font-bold tracking-wider text-wh-brand-ink">{o.couponCode}</span>
                  {offerLine(o) ? <span className="mt-1 block text-[12px] text-wh-muted">{offerLine(o)}</span> : null}
                  {short > 0 ? <span className="mt-0.5 block text-[12px] font-semibold text-wh-deal">Add ₹{formatMoney(short)} more to unlock</span> : null}
                </span>
                <button type="button" disabled={short > 0 || pending} onClick={() => { onApply(String(o.couponCode).toUpperCase()); setOpen(false) }}
                  className={cx("shrink-0 rounded-[8px] px-3 py-1.5 text-[13px] font-bold text-wh-brand-ink hover:bg-wh-brand-50 disabled:text-wh-muted disabled:hover:bg-transparent", focusRing)}>
                  Apply
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
