import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Banknote, CreditCard, LocateFixed, MapPin, Minus, Plus, TicketPercent, Trash2, X } from "lucide-react"
import { servicesAPI, errorMessage } from "../api"
import { useLoad, useServicesConfig } from "../hooks"
import { useBasket } from "../context/BasketContext"
import SlotPicker from "../components/SlotPicker"
import { payForBooking } from "../payment"
import { EmptyState, Skeleton, Thumb, addressText, cx, focusRing, formatMoney, isSignedIn, slotPayload, useRequireLogin } from "../helpers"

/** A platform (food / rides) saved address, in the shape a booking takes. */
const fromPlatform = (a) => {
  const [lng, lat] = Array.isArray(a?.location?.coordinates) ? a.location.coordinates : []
  return {
    key: `p-${a?._id || a?.id}`,
    type: String(a?.label || "home").toLowerCase(),
    label: a?.label || "Home",
    addressLine1: a?.street || "",
    addressLine2: a?.additionalDetails || "",
    landmark: "",
    city: a?.city || "",
    state: a?.state || "",
    pincode: a?.zipCode || "",
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  }
}

const fromSp = (a, n) => ({
  key: `s-${a?._id || n}`,
  type: a?.type || "home",
  label: a?.type ? a.type.charAt(0).toUpperCase() + a.type.slice(1) : "Home",
  addressLine1: a?.addressLine1 || "",
  addressLine2: a?.addressLine2 || "",
  landmark: a?.landmark || "",
  city: a?.city || "",
  state: a?.state || "",
  pincode: a?.pincode || "",
  lat: null,
  lng: null,
})

// The booking endpoint refuses an address without these four.
const complete = (a) => Boolean(a?.addressLine1?.trim() && a?.city?.trim() && a?.state?.trim() && a?.pincode?.trim())

const EMPTY_FORM = { label: "Home", addressLine1: "", addressLine2: "", landmark: "", city: "", state: "", pincode: "", lat: null, lng: null }

function Field({ label, value, onChange, required, inputMode, autoComplete, className }) {
  return (
    <label className={cx("block", className)}>
      <span className="text-xs font-bold text-gray-600">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-violet-500"
      />
    </label>
  )
}

function AddressForm({ initial, onCancel, onDone }) {
  const [f, setF] = useState(initial || EMPTY_FORM)
  const [locating, setLocating] = useState(false)
  // Off by default: saving overwrites the customer's food/rides address of that label.
  const [save, setSave] = useState(false)
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }))

  // Coordinates let dispatch find the nearest professional precisely instead of
  // geocoding the typed address.
  const locate = () => {
    if (!navigator.geolocation) return toast.error("Location is not available on this device.")
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setF((prev) => ({ ...prev, lat: pos.coords.latitude, lng: pos.coords.longitude }))
        setLocating(false)
        toast.success("Location added")
      },
      () => {
        setLocating(false)
        toast.error("Could not get your location. You can still type the address.")
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!complete(f)) return toast.error("Fill in the address, city, state and pincode.")
    const address = { ...f, key: `new-${Date.now()}`, type: f.label.toLowerCase() }
    if (save) {
      // Saved with the platform's addresses so food and rides offer it too. A
      // failure here does not stop the booking; the address is used either way.
      servicesAPI
        .savePlatformAddress({
          label: ["Home", "Office", "Other"].includes(f.label) ? f.label : "Other",
          street: f.addressLine1,
          additionalDetails: [f.addressLine2, f.landmark].filter(Boolean).join(", "),
          city: f.city,
          state: f.state,
          zipCode: f.pincode,
          ...(f.lat != null && f.lng != null ? { latitude: f.lat, longitude: f.lng } : {}),
        })
        .catch(() => {})
    }
    onDone(address)
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex gap-2" role="radiogroup" aria-label="Address type">
        {["Home", "Office", "Other"].map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={f.label === l}
            onClick={() => set("label")(l)}
            className={cx(
              "rounded-full border px-3 py-1 text-xs font-bold",
              f.label === l ? "border-violet-600 bg-violet-600 text-white" : "border-gray-200 bg-white text-gray-700",
              focusRing
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <Field label="House / flat, street" value={f.addressLine1} onChange={set("addressLine1")} required autoComplete="address-line1" />
      <Field label="Area, building (optional)" value={f.addressLine2} onChange={set("addressLine2")} autoComplete="address-line2" />
      <Field label="Landmark (optional)" value={f.landmark} onChange={set("landmark")} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" value={f.city} onChange={set("city")} required autoComplete="address-level2" />
        <Field label="State" value={f.state} onChange={set("state")} required autoComplete="address-level1" />
      </div>
      <Field label="Pincode" value={f.pincode} onChange={set("pincode")} required inputMode="numeric" autoComplete="postal-code" className="w-1/2" />
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        className={cx("flex items-center gap-1.5 rounded text-sm font-bold text-violet-700 disabled:opacity-60", focusRing)}
      >
        <LocateFixed className="h-4 w-4" aria-hidden="true" />
        {f.lat != null ? "Location added. Update it" : locating ? "Finding you..." : "Add my current location"}
      </button>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="h-4 w-4 accent-violet-600" />
        {/* The platform keeps one address per label, so saving replaces it. */}
        Save as my {f.label} address (replaces the saved one)
      </label>
      <div className="flex gap-3">
        {onCancel ? (
          <button type="button" onClick={onCancel} className={cx("flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-bold", focusRing)}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className={cx("flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white", focusRing)}>
          Use this address
        </button>
      </div>
    </form>
  )
}

/** What a coupon gives, in a few words. */
const couponOffer = (c) =>
  c.discountType === "flat-price"
    ? `${formatMoney(c.discountValue)} off`
    : `${c.discountValue}% off${Number(c.maxDiscount) > 0 ? ` up to ${formatMoney(c.maxDiscount)}` : ""}`

/** The coupons the customer can use, in a sheet over the checkout. */
function CouponSheet({ amount, onApply, onClose, busyCode }) {
  const list = useLoad(() => servicesAPI.coupons(), [])
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const coupons = list.data || []
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Offers"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-gray-900">Offers for you</h2>
          <button type="button" onClick={onClose} className={cx("rounded-full p-1.5 text-gray-500 hover:bg-gray-100", focusRing)} aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {list.loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : list.error ? (
            <p className="text-sm text-red-600">{list.error}</p>
          ) : coupons.length ? (
            coupons.map((c) => {
              const short = Number(c.minOrderValue) > amount
              return (
                <div key={c._id || c.couponCode} className="rounded-xl border border-dashed border-violet-300 bg-violet-50/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-extrabold tracking-wide text-violet-700">{c.couponCode}</p>
                      <p className="mt-0.5 text-sm font-bold text-gray-900">{c.title || couponOffer(c)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={short || Boolean(busyCode)}
                      onClick={() => onApply(c.couponCode)}
                      className={cx("shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50", focusRing)}
                    >
                      {busyCode === c.couponCode ? "Applying..." : "Apply"}
                    </button>
                  </div>
                  {c.description ? <p className="mt-1 text-xs text-gray-600">{c.description}</p> : null}
                  <p className="mt-1 text-[11px] text-gray-500">
                    {couponOffer(c)}
                    {Number(c.minOrderValue) > 0 ? ` on bookings of ${formatMoney(c.minOrderValue)} or more` : ""}
                    {c.customerScope === "first-time" ? ". First booking only" : ""}
                    {c.endDate ? `. Valid till ${new Date(c.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                  </p>
                  {short ? (
                    <p className="mt-1 text-[11px] font-bold text-amber-700">
                      Add {formatMoney(Number(c.minOrderValue) - amount)} more to use this
                    </p>
                  ) : null}
                </div>
              )
            })
          ) : (
            <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No offers right now. You can still enter a code you have.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ n, title, children }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-extrabold text-gray-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-xs text-white">{n}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function Checkout() {
  const navigate = useNavigate()
  const basket = useBasket()
  const requireLogin = useRequireLogin()
  const signedIn = isSignedIn()

  useEffect(() => {
    if (basket.count) requireLogin()
  }, [basket.count, requireLogin])

  const config = useServicesConfig()
  const profile = useLoad(() => (signedIn ? servicesAPI.profile() : Promise.resolve(null)), [signedIn])
  const platform = useLoad(
    () => (signedIn ? servicesAPI.platformAddresses().catch(() => []) : Promise.resolve([])),
    [signedIn]
  )

  const addresses = useMemo(() => {
    const out = [...(platform.data || []).map(fromPlatform), ...(profile.data?.addresses || []).map(fromSp)]
    const seen = new Set()
    return out.filter((a) => {
      const k = `${a.addressLine1}|${a.pincode}`.toLowerCase()
      if (!a.addressLine1 || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [platform.data, profile.data])

  const [extra, setExtra] = useState([])
  const allAddresses = [...extra, ...addresses]
  const [addressKey, setAddressKey] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [slot, setSlot] = useState(null)
  const [method, setMethod] = useState("pay_at_home")
  const [placing, setPlacing] = useState(false)
  const placed = useRef(false)
  // The applied coupon, as the server priced it for the amount below.
  const [coupon, setCoupon] = useState(null)
  const [codeInput, setCodeInput] = useState("")
  const [couponBusy, setCouponBusy] = useState("")
  const [couponError, setCouponError] = useState("")
  const [showOffers, setShowOffers] = useState(false)

  const selected = allAddresses.find((a) => a.key === addressKey) || null

  // Pick the first usable address once they load.
  useEffect(() => {
    if (!addressKey && allAddresses.length) setAddressKey(allAddresses[0].key)
  }, [addressKey, allAddresses])

  const settings = config.data || {}
  const onlineEnabled = settings.isOnlinePaymentEnabled !== false
  const visiting = Math.max(0, Number(settings.visitedCharges) || 0)
  // What the coupon applies to: the services, their GST and the visit.
  const beforeDiscount = Math.round((basket.subtotal + basket.tax + visiting) * 100) / 100
  // A cancellation fee still owed from an earlier booking is collected with this one.
  const penalty = Math.max(0, Number(profile.data?.wallet?.penalty) || 0)
  const discount = coupon ? Math.min(coupon.discount, beforeDiscount) : 0
  const total = Math.max(1, Math.round((beforeDiscount - discount + penalty) * 100) / 100)

  // The basket changed under an applied coupon: price it again for the new amount.
  const couponCode = coupon?.code
  const pricedFor = coupon?.amount
  useEffect(() => {
    if (!couponCode || !beforeDiscount || placed.current || pricedFor === beforeDiscount) return undefined
    let live = true
    servicesAPI
      .validateCoupon(couponCode, beforeDiscount)
      .then(
        (res) =>
          live &&
          setCoupon((c) => (c?.code === couponCode ? { ...c, discount: Number(res.discount) || 0, amount: beforeDiscount } : c))
      )
      .catch((err) => {
        if (!live) return
        setCoupon(null)
        setCouponError(errorMessage(err, "The coupon no longer applies."))
      })
    return () => {
      live = false
    }
  }, [couponCode, beforeDiscount, pricedFor])

  if (!basket.count && !placed.current) {
    return (
      <EmptyState
        title="Nothing to book yet"
        text="Add a service to get started."
        action={
          <Link to="/services" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
            Browse services
          </Link>
        }
      />
    )
  }
  if (!signedIn) return null

  const applyCoupon = async (raw) => {
    const code = String(raw || "").trim().toUpperCase()
    if (!code) return setCouponError("Enter a coupon code.")
    setCouponBusy(code)
    setCouponError("")
    try {
      const res = await servicesAPI.validateCoupon(code, beforeDiscount)
      setCoupon({ code: res.coupon.couponCode, title: res.coupon.title, discount: Number(res.discount) || 0, amount: beforeDiscount })
      setCodeInput("")
      toast.success(`${res.coupon.couponCode} applied. You save ${formatMoney(res.discount)}.`)
    } catch (err) {
      setCouponError(errorMessage(err, "This coupon cannot be used."))
    } finally {
      setCouponBusy("")
      setShowOffers(false)
    }
  }

  const place = async () => {
    if (!selected) return toast.error("Choose an address for the visit.")
    if (!complete(selected)) {
      setEditing(selected)
      return toast.error("That address is missing its city, state or pincode.")
    }
    if (!slot?.slot) return toast.error("Choose a date and time.")
    const main = basket.items[0]
    setPlacing(true)
    try {
      const booking = await servicesAPI.createBooking({
        serviceId: main.id,
        address: {
          type: selected.type,
          addressLine1: selected.addressLine1.trim(),
          addressLine2: selected.addressLine2 || "",
          landmark: selected.landmark || "",
          city: selected.city.trim(),
          state: selected.state.trim(),
          pincode: selected.pincode.trim(),
          ...(selected.lat != null && selected.lng != null ? { lat: selected.lat, lng: selected.lng } : {}),
        },
        ...slotPayload(slot.dateKey, slot.slot),
        bookingType: "scheduled",
        paymentMethod: method,
        // The server re-prices from its catalogue and never charges less than
        // that; these figures are what the customer was shown. The coupon is
        // named, not priced: the server works out its discount itself.
        amount: beforeDiscount,
        basePrice: basket.subtotal,
        tax: basket.tax,
        discount: 0,
        visitingCharges: visiting,
        ...(coupon ? { promoCode: coupon.code } : {}),
        serviceCategory: basket.category?.title,
        brandName: main.brandName || undefined,
        brandIcon: main.brandIcon || undefined,
        bookedItems: basket.items.map((it) => ({
          serviceId: it.id,
          brandName: it.brandName,
          brandIcon: it.brandIcon,
          quantity: it.qty,
          card: { serviceId: it.id, title: it.title, price: it.price, imageUrl: it.icon, pricingUnit: it.pricingUnit },
        })),
      })
      placed.current = true
      basket.clear()

      if (method === "online") {
        try {
          const result = await payForBooking(booking._id, {
            prefill: { name: profile.data?.name, contact: profile.data?.phone },
            description: booking.serviceName,
          })
          if (result === "paid") toast.success("Paid. Your booking is confirmed.")
          else toast.message("Booking placed. Payment is pending; you can pay from the booking.")
        } catch (err) {
          toast.error(errorMessage(err, "Payment did not go through. You can pay from the booking."))
        }
      } else {
        toast.success("Booking placed. Finding a professional for you.")
      }
      navigate(`/services/bookings/${booking._id}`, { replace: true })
    } catch (err) {
      if (err?.response?.data?.code === "COUPON_INVALID") {
        setCoupon(null)
        setCouponError(errorMessage(err))
        toast.error(`${errorMessage(err)}. The coupon was removed; check the new total and book again.`)
      } else {
        // The slot closed (or was never open): make the customer pick again.
        if (err?.response?.data?.code === "SLOT_UNAVAILABLE") setSlot((s) => (s ? { ...s, slot: null } : s))
        toast.error(errorMessage(err, "Could not place the booking."))
      }
    } finally {
      setPlacing(false)
    }
  }

  const loadingAddresses = profile.loading || platform.loading

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pb-32 pt-4">
      <h1 className="text-xl font-extrabold text-gray-900">Book {basket.category?.title || "service"}</h1>

      <Section n={1} title="Services">
        <ul className="divide-y divide-gray-100">
          {basket.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 py-3">
              <Thumb src={it.icon || it.brandIcon} name={it.title} className="h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-900">{it.title}</p>
                <p className="text-xs text-gray-500">
                  {formatMoney(it.price)}
                  {it.pricingUnit ? ` / ${it.pricingUnit}` : ""}
                </p>
              </div>
              <div className="flex items-center rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => basket.setQty(it, basket.category, it.qty - 1)}
                  className={cx("p-2", focusRing)}
                  aria-label={it.qty === 1 ? `Remove ${it.title}` : `One less ${it.title}`}
                >
                  {it.qty === 1 ? <Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" /> : <Minus className="h-4 w-4" aria-hidden="true" />}
                </button>
                <span className="w-6 text-center text-sm font-bold">{it.qty}</span>
                <button
                  type="button"
                  onClick={() => basket.setQty(it, basket.category, Math.min(10, it.qty + 1))}
                  className={cx("p-2", focusRing)}
                  aria-label={`One more ${it.title}`}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {basket.category?.id ? (
          <Link to={`/services/category/${basket.category.id}`} className={cx("mt-1 inline-block rounded text-sm font-bold text-violet-700", focusRing)}>
            + Add more from {basket.category.title}
          </Link>
        ) : null}
      </Section>

      <Section n={2} title="Address">
        {loadingAddresses ? (
          <Skeleton className="h-16" />
        ) : editing ? (
          <AddressForm
            initial={{ ...EMPTY_FORM, ...editing, label: editing.label || "Home" }}
            onCancel={() => setEditing(null)}
            onDone={(a) => {
              setExtra((prev) => [a, ...prev])
              setAddressKey(a.key)
              setEditing(null)
            }}
          />
        ) : (
          <>
            {allAddresses.length ? (
              <ul className="space-y-2" role="radiogroup" aria-label="Visit address">
                {allAddresses.map((a) => (
                  <li key={a.key}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={addressKey === a.key}
                      onClick={() => setAddressKey(a.key)}
                      className={cx(
                        "flex w-full items-start gap-3 rounded-xl border p-3 text-left",
                        addressKey === a.key ? "border-violet-600 bg-violet-50" : "border-gray-200",
                        focusRing
                      )}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-gray-900">{a.label}</span>
                        <span className="block text-xs text-gray-600">{addressText(a)}</span>
                        {!complete(a) ? <span className="mt-0.5 block text-xs font-bold text-amber-700">Needs city, state or pincode</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {adding || !allAddresses.length ? (
              <AddressForm
                onCancel={allAddresses.length ? () => setAdding(false) : null}
                onDone={(a) => {
                  setExtra((prev) => [a, ...prev])
                  setAddressKey(a.key)
                  setAdding(false)
                }}
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className={cx("mt-3 rounded text-sm font-bold text-violet-700", focusRing)}>
                + Add a new address
              </button>
            )}
          </>
        )}
      </Section>

      <Section n={3} title="Date and time">
        <SlotPicker value={slot} onChange={setSlot} />
      </Section>

      <Section n={4} title="Payment">
        <div className="space-y-2" role="radiogroup" aria-label="Payment">
          {[
            {
              id: "pay_at_home",
              icon: Banknote,
              title: "Pay after the service",
              text: "Pay the final bill in cash or online once the work is done.",
            },
            ...(onlineEnabled
              ? [{ id: "online", icon: CreditCard, title: "Pay online now", text: "UPI, card or netbanking through Razorpay." }]
              : []),
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={method === m.id}
              onClick={() => setMethod(m.id)}
              className={cx(
                "flex w-full items-start gap-3 rounded-xl border p-3 text-left",
                method === m.id ? "border-violet-600 bg-violet-50" : "border-gray-200",
                focusRing
              )}
            >
              <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
              <span>
                <span className="block text-sm font-bold text-gray-900">{m.title}</span>
                <span className="block text-xs text-gray-600">{m.text}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-labelledby="svc-offers">
        <h2 id="svc-offers" className="flex items-center gap-2 text-base font-extrabold text-gray-900">
          <TicketPercent className="h-5 w-5 text-violet-600" aria-hidden="true" /> Offers
        </h2>
        {coupon ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="min-w-0">
              <p className="font-mono text-sm font-extrabold text-emerald-800">{coupon.code}</p>
              <p className="text-xs text-emerald-800">
                You save {formatMoney(discount)}
                {coupon.title ? ` · ${coupon.title}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCoupon(null)
                setCouponError("")
              }}
              className={cx("shrink-0 rounded text-xs font-bold text-red-600", focusRing)}
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                applyCoupon(codeInput)
              }}
            >
              <label className="flex-1">
                <span className="sr-only">Coupon code</span>
                <input
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value.toUpperCase())
                    setCouponError("")
                  }}
                  placeholder="Enter coupon code"
                  autoCapitalize="characters"
                  aria-invalid={Boolean(couponError)}
                  aria-describedby={couponError ? "svc-coupon-error" : undefined}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-violet-500"
                />
              </label>
              <button
                type="submit"
                disabled={Boolean(couponBusy) || !codeInput.trim()}
                className={cx("rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50", focusRing)}
              >
                {couponBusy && couponBusy === codeInput.trim().toUpperCase() ? "Checking..." : "Apply"}
              </button>
            </form>
            {couponError ? (
              <p id="svc-coupon-error" className="mt-2 text-xs font-bold text-red-600" role="alert">
                {couponError}
              </p>
            ) : null}
            <button type="button" onClick={() => setShowOffers(true)} className={cx("mt-2 rounded text-sm font-bold text-violet-700", focusRing)}>
              View available offers
            </button>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 text-sm shadow-sm" aria-label="Price">
        <dl className="space-y-1.5">
          <div className="flex justify-between"><dt className="text-gray-600">Services</dt><dd>{formatMoney(basket.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-600">GST</dt><dd>{formatMoney(basket.tax)}</dd></div>
          {visiting ? (
            <div className="flex justify-between"><dt className="text-gray-600">Visiting charges</dt><dd>{formatMoney(visiting)}</dd></div>
          ) : null}
          {discount ? (
            <div className="flex justify-between text-emerald-700">
              <dt>Coupon {coupon.code}</dt>
              <dd>- {formatMoney(discount)}</dd>
            </div>
          ) : null}
          {penalty ? (
            <div className="flex justify-between gap-4">
              <dt className="text-gray-600">Cancellation fee from an earlier booking</dt>
              <dd>{formatMoney(penalty)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-extrabold">
            <dt>Total</dt>
            <dd>{formatMoney(total)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-gray-500">
          Parts or extra work the professional adds are billed at the visit.
          {Number(settings.cancellationPenalty) > 0
            ? ` Cancelling after the professional sets out costs ${formatMoney(settings.cancellationPenalty)}.`
            : ""}
        </p>
      </section>

      {showOffers ? (
        <CouponSheet amount={beforeDiscount} busyCode={couponBusy} onApply={applyCoupon} onClose={() => setShowOffers(false)} />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white p-4">
        <button
          type="button"
          onClick={place}
          disabled={placing}
          className={cx(
            "mx-auto block w-full max-w-3xl rounded-2xl bg-violet-600 py-3.5 text-base font-extrabold text-white hover:bg-violet-700 disabled:opacity-60",
            focusRing
          )}
        >
          {placing ? "Placing booking..." : method === "online" ? `Pay ${formatMoney(total)} and book` : `Book for ${formatMoney(total)}`}
        </button>
      </div>
    </div>
  )
}
