import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Check, KeyRound, LifeBuoy, MapPin, Navigation, Phone, Star } from "lucide-react"
import { SUPPORT_PATH } from "../../../shared/superapp/services"
import { servicesAPI, errorMessage } from "../api"
import { useLoad } from "../hooks"
import useBookingLive from "../useBookingLive"
import SlotPicker from "../components/SlotPicker"
import { payForBooking } from "../payment"
import {
  ACTIVE_STATUSES, EmptyState, Skeleton, Stars, StatusPill, TRACK_STEPS, Thumb, addressText, canCancel, canReschedule,
  canReview, cx, focusRing, formatDate, formatDateTime, formatMoney, isSignedIn, slotPayload, statusOf, useRequireLogin,
} from "../helpers"

const POLL_MS = 20000

// Before the professional reaches the door, the visit code is what they ask for.
const SHOW_VISIT_OTP = ["accepted", "assigned", "confirmed", "journey_started"]
const ON_THE_WAY = ["journey_started"]

function Tracker({ status }) {
  const step = statusOf(status).step
  if (step < 0) return null
  return (
    <ol className="mt-4 flex items-start" aria-label="Progress">
      {TRACK_STEPS.map((label, n) => {
        const done = n < step || (n === step && n === TRACK_STEPS.length - 1)
        const current = n === step && !done
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {n > 0 ? (
              <span className={cx("absolute right-1/2 top-3 h-0.5 w-full", n <= step ? "bg-violet-600" : "bg-gray-200")} aria-hidden="true" />
            ) : null}
            <span
              className={cx(
                "relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold",
                done ? "bg-violet-600 text-white" : current ? "bg-white text-violet-700 ring-2 ring-violet-600" : "bg-gray-200 text-gray-500"
              )}
              aria-current={current ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n + 1}
            </span>
            <span className={cx("mt-1.5 text-[10px] font-bold leading-tight", n <= step ? "text-gray-900" : "text-gray-400")}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-extrabold text-gray-900">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

const CANCEL_REASONS = ["Booked by mistake", "Found someone else", "Not needed any more", "Need a different time", "Other"]

function CancelDialog({ booking, onClose, onDone }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0])
  const [busy, setBusy] = useState(false)
  const late = Boolean(booking.journeyStartedAt)
  const submit = async () => {
    setBusy(true)
    try {
      const res = await servicesAPI.cancel(booking._id, reason)
      toast.success(res?.message || "Booking cancelled")
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, "Could not cancel the booking."))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Cancel this booking?" onClose={onClose}>
      <p className="text-sm text-gray-600">
        {late
          ? "The professional is already on the way, so a cancellation fee applies. If you paid online, the rest is refunded to your services wallet."
          : "It is free to cancel now. If you paid online, the full amount goes back to your services wallet."}
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-bold uppercase tracking-wide text-gray-500">Reason</legend>
        {CANCEL_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" name="cancel-reason" checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4 accent-violet-600" />
            {r}
          </label>
        ))}
      </fieldset>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onClose} className={cx("flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold", focusRing)}>
          Keep booking
        </button>
        <button type="button" onClick={submit} disabled={busy} className={cx("flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-60", focusRing)}>
          {busy ? "Cancelling..." : "Cancel booking"}
        </button>
      </div>
    </Modal>
  )
}

function RescheduleDialog({ booking, onClose, onDone }) {
  const [slot, setSlot] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!slot?.slot) return toast.error("Choose a new date and time.")
    setBusy(true)
    try {
      await servicesAPI.reschedule(booking._id, slotPayload(slot.dateKey, slot.slot))
      toast.success("Booking rescheduled")
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, "Could not reschedule."))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Reschedule" onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">
        Now: {formatDate(booking.scheduledDate)}, {booking.scheduledTime}
      </p>
      <SlotPicker value={slot} onChange={setSlot} />
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onClose} className={cx("flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold", focusRing)}>
          Back
        </button>
        <button type="button" onClick={submit} disabled={busy} className={cx("flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-60", focusRing)}>
          {busy ? "Saving..." : "Confirm new time"}
        </button>
      </div>
    </Modal>
  )
}

function ReviewForm({ booking, onDone }) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!rating) return toast.error("Tap a star to rate.")
    setBusy(true)
    try {
      await servicesAPI.review(booking._id, rating, text.trim())
      toast.success("Thanks for the review")
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the review."))
    } finally {
      setBusy(false)
    }
  }
  const shown = hover || rating
  return (
    <form onSubmit={submit} className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
      <h2 className="text-base font-extrabold text-gray-900">How was the service?</h2>
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            className={cx("rounded p-0.5", focusRing)}
          >
            <Star className={cx("h-8 w-8", n <= shown ? "fill-amber-400 text-amber-400" : "text-gray-300")} aria-hidden="true" />
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="sr-only">Your review</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Tell others what went well, or what did not (optional)"
          className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-violet-500"
        />
      </label>
      <button type="submit" disabled={busy} className={cx("mt-3 w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white disabled:opacity-60", focusRing)}>
        {busy ? "Submitting..." : "Submit review"}
      </button>
    </form>
  )
}

function Row({ label, value, strong, tone }) {
  return (
    <div
      className={cx(
        "flex justify-between gap-4",
        strong && "border-t border-gray-100 pt-2 text-base font-extrabold",
        tone === "green" && "text-emerald-700"
      )}
    >
      <dt className={strong || tone ? "" : "text-gray-600"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export default function BookingDetail() {
  const { bookingId } = useParams()
  const requireLogin = useRequireLogin()
  const signedIn = isSignedIn()
  useEffect(() => {
    requireLogin()
  }, [requireLogin])

  const detail = useLoad(() => (signedIn ? servicesAPI.booking(bookingId) : Promise.resolve(null)), [bookingId, signedIn])
  const booking = detail.data
  const active = booking && ACTIVE_STATUSES.includes(booking.status)
  const { reload } = detail
  const refresh = useCallback(() => reload(true), [reload])

  const { location, connected } = useBookingLive(signedIn ? bookingId : null, refresh, { track: Boolean(active) })

  // Poll while the booking is still moving; the socket just makes it quicker.
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [active, refresh])

  const [dialog, setDialog] = useState(null)
  const [paying, setPaying] = useState(false)

  if (!signedIn) return null
  if (detail.loading && !booking) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (!booking) {
    return (
      <EmptyState
        title="Booking not found"
        text={detail.error}
        action={
          <Link to="/services/bookings" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
            My bookings
          </Link>
        }
      />
    )
  }

  const pro = booking.workerId || booking.vendorId || null
  const proName = pro?.businessName || pro?.name
  const bill = booking.bill
  const unpaid = !["success", "refunded", "plan_covered", "collected_by_vendor"].includes(booking.paymentStatus)
  // Online payment makes sense before the visit when the customer chose it, and
  // after the work once the bill is in. In between the total may still change.
  const canPayOnline =
    unpaid &&
    booking.status !== "cancelled" &&
    (["work_done", "completed"].includes(booking.status) || (booking.paymentMethod === "online" && !bill))

  const pay = async () => {
    setPaying(true)
    try {
      const result = await payForBooking(booking._id, { description: booking.serviceName })
      if (result === "paid") toast.success("Payment received. Thank you!")
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, "Payment did not go through."))
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pb-16 pt-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Thumb src={booking.categoryIcon || booking.serviceId?.iconUrl} name={booking.serviceName} className="h-14 w-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-extrabold leading-tight text-gray-900">{booking.serviceName}</h1>
            <p className="text-xs text-gray-500">
              #{booking.bookingNumber} · booked {formatDateTime(booking.createdAt)}
            </p>
            <StatusPill status={booking.status} className="mt-1.5" />
          </div>
        </div>
        <Tracker status={booking.status} />
        {["searching", "requested"].includes(booking.status) ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <span className="h-2 w-2 animate-ping rounded-full bg-amber-500" aria-hidden="true" />
            Asking professionals near you. This usually takes a few minutes.
          </p>
        ) : null}
        {booking.status === "no_vendors" ? (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
            No professional was free for this slot. Cancel it{booking.paymentStatus === "success" ? " for a full refund" : ""} and
            book again for another time.
          </p>
        ) : null}
        {booking.status === "cancelled" ? (
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
            Cancelled{booking.cancelledBy === "user" ? " by you" : ""}
            {booking.cancellationReason ? `: ${booking.cancellationReason}` : ""}.
            {booking.refundedAmount ? ` ${formatMoney(booking.refundedAmount)} refunded to your services wallet.` : ""}
          </p>
        ) : null}
        {active ? (
          <p className="mt-3 text-[11px] text-gray-400" aria-live="polite">
            {connected ? "Live updates on" : "Updating every few seconds"}
          </p>
        ) : null}
      </section>

      {booking.visitOtp && SHOW_VISIT_OTP.includes(booking.status) ? (
        <section className="flex items-center gap-3 rounded-2xl bg-violet-600 p-4 text-white">
          <KeyRound className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-bold">Visit code</p>
            <p className="text-xs text-violet-100">Share it with the professional when they arrive, not before.</p>
          </div>
          <p className="text-2xl font-extrabold tracking-[0.3em]">{booking.visitOtp}</p>
        </section>
      ) : null}

      {booking.paymentOtp && unpaid && ["work_done", "completed"].includes(booking.status) ? (
        <section className="flex items-center gap-3 rounded-2xl bg-emerald-600 p-4 text-white">
          <KeyRound className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-bold">Cash payment code</p>
            <p className="text-xs text-emerald-100">Share it only after you have paid the professional in cash.</p>
          </div>
          <p className="text-2xl font-extrabold tracking-[0.3em]">{booking.paymentOtp}</p>
        </section>
      ) : null}

      {pro ? (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-extrabold text-gray-900">Your professional</h2>
          <div className="mt-3 flex items-center gap-3">
            <Thumb src={pro.profilePhoto} name={proName} className="h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              {pro._id ? (
                <Link to={`/services/pro/${pro._id}`} className={cx("block truncate rounded font-bold text-gray-900 hover:underline", focusRing)}>
                  {proName}
                </Link>
              ) : (
                <p className="truncate font-bold text-gray-900">{proName}</p>
              )}
              {pro.rating ? (
                <p className="flex items-center gap-1 text-xs text-gray-600">
                  <Stars value={pro.rating} size={11} /> {Number(pro.rating).toFixed(1)}
                  {pro.totalJobs ? ` · ${pro.totalJobs} jobs` : ""}
                </p>
              ) : null}
            </div>
            {pro.phone && active ? (
              <a href={`tel:${pro.phone}`} className={cx("flex items-center gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-sm font-bold text-violet-700", focusRing)}>
                <Phone className="h-4 w-4" aria-hidden="true" /> Call
              </a>
            ) : null}
          </div>
          {location && ON_THE_WAY.includes(booking.status) ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`}
              target="_blank"
              rel="noreferrer"
              className={cx("mt-3 flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-700", focusRing)}
            >
              <Navigation className="h-4 w-4" aria-hidden="true" />
              See where they are now (updated {new Date(location.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })})
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-extrabold text-gray-900">Appointment</h2>
        <p className="mt-2 text-sm text-gray-800">
          {formatDate(booking.scheduledDate)}, {booking.scheduledTime}
        </p>
        <p className="mt-2 flex gap-2 text-sm text-gray-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
          {addressText(booking.address)}
        </p>
        {canReschedule(booking) || canCancel(booking) ? (
          <div className="mt-4 flex gap-3">
            {canReschedule(booking) ? (
              <button type="button" onClick={() => setDialog("reschedule")} className={cx("flex-1 rounded-xl border border-violet-600 py-2.5 text-sm font-bold text-violet-700", focusRing)}>
                Reschedule
              </button>
            ) : null}
            {canCancel(booking) ? (
              <button type="button" onClick={() => setDialog("cancel")} className={cx("flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-red-600", focusRing)}>
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {canReview(booking) ? <ReviewForm booking={booking} onDone={refresh} /> : null}
      {booking.rating ? (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-extrabold text-gray-900">Your review</h2>
          <Stars value={booking.rating} className="mt-2" />
          {booking.review ? <p className="mt-1.5 text-sm text-gray-700">{booking.review}</p> : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 text-sm shadow-sm">
        <h2 className="text-sm font-extrabold text-gray-900">{bill ? "Bill" : "Price"}</h2>
        {booking.bookedItems?.length && !bill ? (
          <ul className="mt-2 space-y-1 text-gray-700">
            {booking.bookedItems.map((it, n) => (
              <li key={n} className="flex justify-between gap-4">
                <span>
                  {it.card?.title || booking.serviceName} x {it.quantity || 1}
                </span>
                <span>{formatMoney((Number(it.card?.price) || 0) * (it.quantity || 1))}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {bill ? (
          <dl className="mt-2 space-y-1.5">
            {(bill.services || []).map((it, n) => (
              <Row key={`s${n}`} label={`${it.name} x ${it.quantity || 1}`} value={formatMoney(it.total)} />
            ))}
            {(bill.parts || []).map((it, n) => (
              <Row key={`p${n}`} label={`${it.name} x ${it.quantity || 1} (part)`} value={formatMoney(it.total)} />
            ))}
            {(bill.customItems || []).map((it, n) => (
              <Row key={`c${n}`} label={`${it.name || "Item"} x ${it.quantity || 1}`} value={formatMoney(it.total)} />
            ))}
            {bill.visitingCharges ? <Row label="Visiting charges" value={formatMoney(bill.visitingCharges)} /> : null}
            {bill.transportCharges ? <Row label="Transport" value={formatMoney(bill.transportCharges)} /> : null}
            {bill.couponDiscount ? (
              <Row label={`Coupon${booking.promoCode ? ` ${booking.promoCode}` : ""}`} value={`- ${formatMoney(bill.couponDiscount)}`} tone="green" />
            ) : null}
            <Row label="Total" value={formatMoney(bill.grandTotal ?? booking.finalAmount)} strong />
          </dl>
        ) : (
          <dl className="mt-2 space-y-1.5">
            <Row label="Services" value={formatMoney(booking.basePrice)} />
            {booking.discount ? <Row label="Discount" value={`- ${formatMoney(booking.discount)}`} /> : null}
            {booking.tax ? <Row label="GST" value={formatMoney(booking.tax)} /> : null}
            {booking.visitingCharges ? <Row label="Visiting charges" value={formatMoney(booking.visitingCharges)} /> : null}
            {booking.promoDiscount ? (
              <Row label={`Coupon${booking.promoCode ? ` ${booking.promoCode}` : ""}`} value={`- ${formatMoney(booking.promoDiscount)}`} tone="green" />
            ) : null}
            <Row label="Total" value={formatMoney(booking.finalAmount)} strong />
          </dl>
        )}
        <p className="mt-3 text-xs text-gray-500">
          {booking.paymentStatus === "success"
            ? `Paid${booking.paymentMethod === "online" ? " online" : ""}.`
            : booking.paymentStatus === "refunded"
              ? "Refunded."
              : booking.paymentStatus === "collected_by_vendor"
                ? "Paid to the professional."
                : booking.paymentMethod === "online"
                  ? "Payment pending."
                  : "Pay after the service, in cash or online."}
        </p>
        {canPayOnline ? (
          <button type="button" onClick={pay} disabled={paying} className={cx("mt-3 w-full rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white disabled:opacity-60", focusRing)}>
            {paying ? "Opening payment..." : `Pay ${formatMoney(bill?.grandTotal ?? booking.finalAmount)} online`}
          </button>
        ) : null}
      </section>

      <Link
        to={SUPPORT_PATH}
        className={cx("flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-sm shadow-sm hover:border-violet-200", focusRing)}
      >
        <LifeBuoy className="h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-bold text-gray-900">Need help with this booking?</span>
          <span className="block text-xs text-gray-500">Raise a ticket with booking #{booking.bookingNumber}</span>
        </span>
      </Link>

      {dialog === "cancel" ? (
        <CancelDialog booking={booking} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh() }} />
      ) : null}
      {dialog === "reschedule" ? (
        <RescheduleDialog booking={booking} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh() }} />
      ) : null}
    </div>
  )
}
