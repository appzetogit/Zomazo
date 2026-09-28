import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Banknote, CreditCard, Home, Loader2, MapPin, Minus, Plus, Trash2 } from "lucide-react"
import { initRazorpayPayment } from "@food/utils/razorpay"
import { quickAPI, errorMessage } from "../api"
import { useQuickCart } from "../context/QuickCartContext"
import { useQuickLocation } from "../context/QuickLocationContext"
import CouponBox from "../components/CouponBox"
import { ImagePlaceholder, cx, focusRing, formatMoney, isRealImage, isSignedIn } from "../helpers"

/**
 * Cart and checkout in one screen, for one store.
 *
 * The server is the price: every change re-asks /qc/orders/calculate, and the
 * bill shown is what it returned -- delivery, platform fee and taxes included.
 * Placing the order sends the same items; the server re-prices once more and
 * refuses anything it would not have quoted (closed store, stock, zone).
 */
const addressLine = (a) => [a?.additionalDetails, a?.street, a?.city].filter(Boolean).join(", ")

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `qc-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function Stepper({ line, onChange }) {
  const atMax = line.maxQty != null && line.quantity >= line.maxQty
  return (
    <div className="flex h-[30px] w-[86px] items-stretch overflow-hidden rounded-[6px] bg-wh-brand-ink text-white" role="group" aria-label={`Quantity of ${line.name}`}>
      <button type="button" onClick={() => onChange(line.quantity - 1)} aria-label={line.quantity === 1 ? `Remove ${line.name}` : `Decrease ${line.name}`}
        className={cx("flex w-[26px] items-center justify-center hover:bg-[#93400a]", focusRing)}>
        {line.quantity === 1 ? <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <span className="flex flex-1 items-center justify-center text-[13px] font-semibold tabular-nums">{line.quantity}</span>
      <button type="button" onClick={() => onChange(line.quantity + 1)} disabled={atMax} aria-label={`Increase ${line.name}`}
        className={cx("flex w-[26px] items-center justify-center hover:bg-[#93400a] disabled:opacity-50", focusRing)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

/** The customer's quick-commerce addresses, with the platform's offered to reuse. */
function AddressPicker({ selectedId, onSelect }) {
  const { location } = useQuickLocation()
  const [addresses, setAddresses] = useState(null)
  const [platform, setPlatform] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ label: "Home", street: "", additionalDetails: "", city: "", state: "", zipCode: "", phone: "" })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [own, shared] = await Promise.all([quickAPI.addresses().catch(() => []), quickAPI.platformAddresses().catch(() => [])])
    setAddresses(own)
    setPlatform(shared.filter((a) => Number(a.latitude ?? a.location?.coordinates?.[1])))
    if (!selectedId && own.length) onSelect((own.find((a) => a.isDefault) || own[0]))
  }, [selectedId, onSelect])

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body) => {
    setSaving(true)
    try {
      const address = await quickAPI.addAddress(body)
      await load()
      onSelect(address)
      setAdding(false)
    } catch (err) {
      toast.error(errorMessage(err, "The address could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  const importPlatform = (a) =>
    save({
      label: a.label || "Home",
      street: a.street || a.address || "",
      additionalDetails: a.additionalDetails || "",
      city: a.city || "",
      state: a.state || "",
      zipCode: a.zipCode || "",
      phone: a.phone || "",
      latitude: Number(a.latitude ?? a.location?.coordinates?.[1]),
      longitude: Number(a.longitude ?? a.location?.coordinates?.[0]),
    })

  const submitNew = (e) => {
    e.preventDefault()
    if (!location) {
      toast.error("Allow location access so the rider can find this address.")
      return
    }
    save({ ...form, latitude: location.latitude, longitude: location.longitude })
  }

  if (addresses === null) return <p className="text-[13px] text-wh-muted">Loading addresses…</p>

  const input = "h-10 w-full rounded-[8px] border border-wh-border px-3 text-[14px] outline-none focus:border-wh-brand-ink"
  return (
    <div className="flex flex-col gap-2">
      {addresses.map((a) => (
        <label key={a._id} className={cx("flex cursor-pointer items-start gap-3 rounded-[10px] border p-3", String(selectedId) === String(a._id) ? "border-wh-brand-ink bg-wh-brand-50" : "border-wh-border")}>
          <input type="radio" name="qc-address" className="mt-1 accent-[#B45309]" checked={String(selectedId) === String(a._id)} onChange={() => onSelect(a)} />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-wh-text">{a.label}</span>
            <span className="block text-[13px] text-wh-muted">{addressLine(a)}</span>
          </span>
        </label>
      ))}
      {!addresses.length && platform.length ? (
        <div className="rounded-[10px] border border-dashed border-wh-border p-3">
          <p className="mb-2 text-[13px] text-wh-muted">Use an address you saved for food or rides:</p>
          {platform.slice(0, 3).map((a) => (
            <button key={a._id || a.id} type="button" disabled={saving} onClick={() => importPlatform(a)}
              className={cx("mb-1.5 flex w-full items-start gap-2 rounded-[8px] bg-[#F7F7F7] p-2 text-left text-[13px] hover:bg-wh-brand-50", focusRing)}>
              <Home className="mt-0.5 h-4 w-4 shrink-0 text-wh-brand-ink" aria-hidden="true" />
              <span><strong>{a.label || "Saved"}</strong> · {addressLine(a)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {adding ? (
        <form onSubmit={submitNew} className="grid grid-cols-2 gap-2 rounded-[10px] border border-wh-border p-3">
          <select className={cx(input, "col-span-2")} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Address label">
            <option>Home</option><option>Office</option><option>Other</option>
          </select>
          <input className={cx(input, "col-span-2")} required placeholder="House / flat, street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
          <input className={cx(input, "col-span-2")} placeholder="Landmark (optional)" value={form.additionalDetails} onChange={(e) => setForm({ ...form, additionalDetails: e.target.value })} />
          <input className={input} required placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <input className={input} required placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <input className={input} placeholder="PIN code" inputMode="numeric" value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} />
          <input className={input} placeholder="Phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <p className="col-span-2 flex items-center gap-1 text-[12px] text-wh-muted"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Pinned to your current location.</p>
          <div className="col-span-2 flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className={cx("h-10 flex-1 rounded-[8px] border border-wh-border text-[14px]", focusRing)}>Cancel</button>
            <button type="submit" disabled={saving} className={cx("h-10 flex-1 rounded-[8px] bg-wh-brand-ink text-[14px] font-bold text-white disabled:opacity-60", focusRing)}>{saving ? "Saving…" : "Save address"}</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={cx("h-10 rounded-[10px] border border-dashed border-wh-brand-ink text-[14px] font-semibold text-wh-brand-ink", focusRing)}>
          + Add a new address
        </button>
      )}
    </div>
  )
}

export default function CartPage() {
  const navigate = useNavigate()
  const { cart, setQty, clear } = useQuickCart()
  const { zoneId } = useQuickLocation()
  const signedIn = isSignedIn()
  const [address, setAddress] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState("")
  const [quoting, setQuoting] = useState(false)
  const [method, setMethod] = useState("razorpay")
  const [placing, setPlacing] = useState(false)
  // The code the customer asked for, and one the server just refused.
  const [couponCode, setCouponCode] = useState("")
  const [couponRefused, setCouponRefused] = useState("")
  const idemKey = useRef(newIdempotencyKey())

  const items = useMemo(
    () =>
      cart.lines.map((l) => ({
        itemId: l.itemId,
        name: l.variantName ? l.name.split(" · ")[0] : l.name,
        price: l.price,
        quantity: l.quantity,
        ...(l.variantId ? { variantId: l.variantId, variantName: l.variantName, variantPrice: l.price } : {}),
        image: l.image || undefined,
      })),
    [cart.lines],
  )

  // Re-price on every change. Signed-out customers still see the item total.
  useEffect(() => {
    if (!signedIn || !items.length) {
      setQuote(null)
      return undefined
    }
    let cancelled = false
    setQuoting(true)
    setQuoteError("")
    const timer = setTimeout(() => {
      quickAPI
        .calculate({
          items, restaurantId: cart.storeId, deliveryAddressId: address?._id, zoneId: zoneId || undefined, deliveryMode: "quick",
          couponCode: couponCode || undefined,
        })
        .then((d) => {
          if (cancelled) return
          const pricing = d.pricing || null
          // The server prices a code it will not honour as no discount at all,
          // without saying why; the box explains it and the code is dropped, so
          // the bill shown is the one that will be charged.
          if (couponCode && pricing && !pricing.appliedCoupon) {
            setCouponRefused(couponCode)
            setCouponCode("")
          }
          setQuote(pricing)
        })
        .catch((err) => {
          if (cancelled) return
          setQuote(null)
          setQuoteError(errorMessage(err, "The bill could not be worked out."))
        })
        .finally(() => !cancelled && setQuoting(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [items, cart.storeId, address?._id, zoneId, signedIn, couponCode])

  const applyCoupon = (code) => {
    setCouponRefused("")
    setCouponCode(code)
  }
  const removeCoupon = () => {
    setCouponRefused("")
    setCouponCode("")
  }
  const appliedCoupon = couponCode && quote?.appliedCoupon ? quote.appliedCoupon : null

  const itemTotal = cart.lines.reduce((s, l) => s + l.price * l.quantity, 0)

  const placeOrder = async () => {
    if (!address) return toast.error("Choose where to deliver.")
    if (!quote) return toast.error(quoteError || "The bill is not ready yet.")
    setPlacing(true)
    try {
      const lat = Number(address.latitude ?? address.location?.coordinates?.[1])
      const lng = Number(address.longitude ?? address.location?.coordinates?.[0])
      const { order, razorpay } = await quickAPI.createOrder(
        {
          items,
          restaurantId: cart.storeId,
          restaurantName: cart.storeName,
          // Only a code the quote actually applied; the server re-checks it.
          pricing: { subtotal: quote.subtotal, total: quote.total, couponCode: appliedCoupon?.code || undefined },
          paymentMethod: method,
          address: {
            label: address.label, street: address.street, additionalDetails: address.additionalDetails,
            city: address.city, state: address.state, zipCode: address.zipCode, phone: address.phone,
            latitude: lat, longitude: lng, location: { type: "Point", coordinates: [lng, lat] },
          },
          zoneId: zoneId || undefined,
          deliveryMode: "quick",
        },
        idemKey.current,
      )
      const orderId = order?._id || order?.orderMongoId || order?.id
      if (method === "cash") {
        clear()
        idemKey.current = newIdempotencyKey()
        navigate(`/quick/orders/${orderId}`, { replace: true })
        return
      }
      if (!razorpay?.orderId || !razorpay?.key) {
        await quickAPI.abandonPayment(orderId).catch(() => {})
        throw new Error("Online payment is not available right now. Try cash on delivery.")
      }
      await initRazorpayPayment({
        key: razorpay.key,
        amount: razorpay.amount,
        currency: razorpay.currency || "INR",
        order_id: razorpay.orderId,
        description: `Quick order from ${cart.storeName || "store"}`,
        handler: async (res) => {
          try {
            await quickAPI.verifyPayment({
              orderId,
              razorpayOrderId: res.razorpay_order_id,
              razorpayPaymentId: res.razorpay_payment_id,
              razorpaySignature: res.razorpay_signature,
            })
            clear()
            navigate(`/quick/orders/${orderId}`, { replace: true })
          } catch (err) {
            toast.error(errorMessage(err, "Payment could not be confirmed. If money was taken it will be refunded."))
          } finally {
            setPlacing(false)
            idemKey.current = newIdempotencyKey()
          }
        },
        onError: (err) => {
          toast.error(err?.description || "Payment failed. Please try again.")
          setPlacing(false)
        },
        onClose: () => {
          quickAPI.abandonPayment(orderId).catch(() => {})
          idemKey.current = newIdempotencyKey()
          setPlacing(false)
        },
      })
    } catch (err) {
      toast.error(errorMessage(err, "The order could not be placed."))
      setPlacing(false)
    }
  }

  if (!cart.lines.length) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-20 text-center">
        <h1 className="text-[20px] font-black text-wh-text">Your cart is empty</h1>
        <p className="mt-2 text-[14px] text-wh-muted">Add something from a store near you and it gets here in minutes.</p>
        <Link to="/quick" className={cx("mt-6 inline-flex h-11 items-center rounded-[10px] bg-wh-brand-ink px-6 text-[14px] font-bold text-white", focusRing)}>Start shopping</Link>
      </div>
    )
  }

  const row = (label, amount, strong = false) =>
    amount ? (
      <div className={cx("flex justify-between text-[14px]", strong ? "font-bold text-wh-text" : "text-wh-muted")}>
        <span>{label}</span>
        <span>₹{formatMoney(amount)}</span>
      </div>
    ) : null

  return (
    <div className="mx-auto grid max-w-[1100px] gap-3 px-3 py-3 lg:grid-cols-[1fr_380px] lg:px-6">
      <div className="flex flex-col gap-3">
        <section className="rounded-[8px] bg-wh-surface p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h1 className="text-[19px] font-black tracking-tight text-wh-text">Your cart</h1>
            <Link to={`/quick/store/${cart.storeId}`} className="text-[13px] font-semibold text-wh-link">{cart.storeName || "Store"} →</Link>
          </div>
          <ul className="divide-y divide-wh-border">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex items-center gap-3 py-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#F7F7F7]">
                  {isRealImage(l.image) ? <img src={l.image} alt="" className="h-full w-full object-contain mix-blend-multiply" /> : <ImagePlaceholder name={l.name} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[14px] font-medium text-wh-text">{l.name}</span>
                  {l.pack ? <span className="block text-[12px] text-wh-muted">{l.pack}</span> : null}
                  <span className="block text-[14px] font-bold text-wh-text">₹{formatMoney(l.price * l.quantity)}</span>
                </span>
                <Stepper line={l} onChange={(q) => setQty(l.key, q)} />
              </li>
            ))}
          </ul>
        </section>

        {signedIn ? (
          <section className="rounded-[8px] bg-wh-surface p-4">
            <h2 className="mb-3 text-[16px] font-bold text-wh-text">Deliver to</h2>
            <AddressPicker selectedId={address?._id} onSelect={setAddress} />
          </section>
        ) : null}
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-[132px] lg:self-start">
        {signedIn ? (
          <section className="rounded-[8px] bg-wh-surface p-4">
            <h2 className="mb-3 text-[16px] font-bold text-wh-text">Offers</h2>
            <CouponBox
              storeId={cart.storeId}
              subtotal={Number(quote?.subtotal ?? itemTotal)}
              applied={appliedCoupon}
              refused={couponRefused}
              pending={quoting && Boolean(couponCode) && !appliedCoupon}
              onApply={applyCoupon}
              onRemove={removeCoupon}
            />
          </section>
        ) : null}
        <section className="rounded-[8px] bg-wh-surface p-4">
          <h2 className="mb-3 text-[16px] font-bold text-wh-text">Bill</h2>
          {quote ? (
            <div className="flex flex-col gap-1.5">
              {row("Items", quote.subtotal)}
              {row("Delivery", quote.deliveryFee)}
              {row("Delivery GST", quote.deliveryFeeGst)}
              {/* Only present while the admin has a surge on for this zone. */}
              {row("Surge (busy area)", quote.surgeAmount)}
              {row("Platform fee", quote.platformFee)}
              {row("Taxes", quote.tax)}
              {quote.discount ? (
                <div className="flex justify-between text-[14px] text-wh-success">
                  <span>{appliedCoupon ? `Coupon ${appliedCoupon.code}` : "Discount"}</span>
                  <span>−₹{formatMoney(quote.discount)}</span>
                </div>
              ) : null}
              <div className="my-1 border-t border-wh-border" />
              {row("To pay", quote.total, true)}
              {quote.discount ? <p className="text-[12px] font-semibold text-wh-success">You save ₹{formatMoney(quote.discount)} on this order</p> : null}
              {quote.deliveryPromiseMinutes ? <p className="text-[12px] font-semibold text-wh-success">Arrives in about {quote.deliveryPromiseMinutes} minutes</p> : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {row("Items", itemTotal, true)}
              <p className="text-[12px] text-wh-muted">{quoting ? "Working out delivery and fees…" : quoteError || (signedIn ? "Choose an address to see delivery and fees." : "Delivery and fees are added at checkout.")}</p>
            </div>
          )}
        </section>

        {signedIn ? (
          <section className="rounded-[8px] bg-wh-surface p-4">
            <h2 className="mb-3 text-[16px] font-bold text-wh-text">Pay with</h2>
            {[
              { key: "razorpay", label: "UPI, card or net banking", icon: CreditCard },
              { key: "cash", label: "Cash on delivery", icon: Banknote },
            ].map(({ key, label, icon: Icon }) => (
              <label key={key} className={cx("mb-2 flex cursor-pointer items-center gap-3 rounded-[10px] border p-3", method === key ? "border-wh-brand-ink bg-wh-brand-50" : "border-wh-border")}>
                <input type="radio" name="qc-pay" className="accent-[#B45309]" checked={method === key} onChange={() => setMethod(key)} />
                <Icon className="h-4 w-4 text-wh-brand-ink" aria-hidden="true" />
                <span className="text-[14px] text-wh-text">{label}</span>
              </label>
            ))}
            <button type="button" onClick={placeOrder} disabled={placing || quoting || !quote || !address}
              className={cx("mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-wh-brand-ink text-[15px] font-bold text-white disabled:opacity-50", focusRing)}>
              {placing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {placing ? "Placing order…" : quote ? `Place order · ₹${formatMoney(quote.total)}` : "Place order"}
            </button>
          </section>
        ) : (
          <button type="button" onClick={() => navigate("/login", { state: { from: { pathname: "/quick/cart" } } })}
            className={cx("h-12 w-full rounded-[10px] bg-wh-brand-ink text-[15px] font-bold text-white", focusRing)}>
            Sign in to check out
          </button>
        )}
      </aside>
    </div>
  )
}
