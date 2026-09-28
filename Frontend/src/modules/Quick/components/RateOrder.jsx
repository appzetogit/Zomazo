/**
 * Rating a delivered Quick order: the store, and the rider when one delivered
 * it (the server requires both then). One submission per order -- afterwards
 * the card shows what was given.
 */
import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Star } from "lucide-react"
import { quickAPI, errorMessage } from "../api"
import { cx, focusRing } from "../helpers"

const LABELS = ["", "Bad", "Poor", "Okay", "Good", "Great"]

function Stars({ value, onChange, label, readOnly = false }) {
  return (
    <div role={readOnly ? "img" : "radiogroup"} aria-label={readOnly ? `${label}: ${value} of 5` : label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <Star key={n} className={cx("h-5 w-5", n <= value ? "fill-amber-400 text-amber-400" : "text-[#D1D5DB]")} aria-hidden="true" />
        ) : (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => onChange(n)}
            className={cx("rounded p-0.5", focusRing)}>
            <Star className={cx("h-7 w-7 transition-colors", n <= value ? "fill-amber-400 text-amber-400" : "text-[#D1D5DB] hover:text-amber-300")} aria-hidden="true" />
          </button>
        ),
      )}
      {!readOnly && value ? <span className="ml-1 text-[13px] font-semibold text-wh-muted">{LABELS[value]}</span> : null}
    </div>
  )
}

export default function RateOrder({ order, storeName, riderName, onRated }) {
  const given = order?.ratings || {}
  const storeGiven = Number(given.restaurant?.rating) || 0
  const riderGiven = Number(given.deliveryPartner?.rating) || 0
  const hasRider = Boolean(order?.dispatch?.deliveryPartnerId)
  const [store, setStore] = useState(0)
  const [rider, setRider] = useState(0)
  const [comment, setComment] = useState("")
  const [riderComment, setRiderComment] = useState("")
  const [saving, setSaving] = useState(false)

  if (storeGiven) {
    return (
      <section className="rounded-[10px] bg-wh-surface p-4">
        <h2 className="mb-2 text-[16px] font-bold text-wh-text">Your rating</h2>
        <div className="flex flex-col gap-2 text-[14px] text-wh-text">
          <div className="flex items-center justify-between gap-3"><span>{storeName}</span><Stars value={storeGiven} label={storeName} readOnly /></div>
          {riderGiven ? <div className="flex items-center justify-between gap-3"><span>{riderName || "Delivery partner"}</span><Stars value={riderGiven} label="Delivery partner" readOnly /></div> : null}
          {given.restaurant?.comment ? <p className="text-[13px] text-wh-muted">&ldquo;{given.restaurant.comment}&rdquo;</p> : null}
        </div>
      </section>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!store) return toast.error("Tap a star to rate the store.")
    if (hasRider && !rider) return toast.error("Tap a star to rate your delivery partner.")
    setSaving(true)
    try {
      const updated = await quickAPI.rateOrder(order._id || order.orderMongoId, {
        restaurantRating: store,
        ...(comment.trim() ? { restaurantComment: comment.trim().slice(0, 500) } : {}),
        ...(hasRider ? { deliveryPartnerRating: rider } : {}),
        ...(hasRider && riderComment.trim() ? { deliveryPartnerComment: riderComment.trim().slice(0, 500) } : {}),
      })
      toast.success("Thanks for rating your order")
      onRated?.(updated)
    } catch (err) {
      toast.error(errorMessage(err, "Your rating could not be sent."))
    } finally {
      setSaving(false)
    }
  }

  const input = "w-full rounded-[8px] border border-wh-border px-3 py-2 text-[14px] outline-none focus:border-wh-brand-ink"
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[10px] bg-wh-surface p-4">
      <h2 className="text-[16px] font-bold text-wh-text">How was your order?</h2>
      <div className="flex flex-col gap-1.5">
        <p className="text-[14px] font-semibold text-wh-text">{storeName}</p>
        <Stars value={store} onChange={setStore} label={`Rate ${storeName}`} />
        <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you like, or what went wrong? (optional)" className={input} />
      </div>
      {hasRider ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[14px] font-semibold text-wh-text">{riderName || "Your delivery partner"}</p>
          <Stars value={rider} onChange={setRider} label="Rate your delivery partner" />
          <textarea rows={2} maxLength={500} value={riderComment} onChange={(e) => setRiderComment(e.target.value)} placeholder="A word for the rider (optional)" className={input} />
        </div>
      ) : null}
      <button type="submit" disabled={saving}
        className={cx("flex h-11 items-center justify-center gap-2 rounded-[10px] bg-wh-brand-ink text-[14px] font-bold text-white disabled:opacity-60", focusRing)}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {saving ? "Sending…" : "Submit rating"}
      </button>
    </form>
  )
}
