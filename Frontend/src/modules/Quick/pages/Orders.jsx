import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { io } from "socket.io-client"
import { toast } from "sonner"
import { Bike, Check, ChevronRight, Clock, HelpCircle, KeyRound, Loader2, Package, Phone, Receipt, Store } from "lucide-react"
import { API_BASE_URL } from "@food/api/config"
import { ALL_ORDERS_PATH, SUPPORT_PATH } from "@/shared/superapp/services"
import { quickAPI, errorMessage } from "../api"
import TrackingMap, { toLatLng } from "../components/TrackingMap"
import RateOrder from "../components/RateOrder"
import { cx, focusRing, formatMoney } from "../helpers"

/** The customer's quick orders, and one order's live progress. */

const STEPS = [
  { key: "placed", label: "Order placed", statuses: ["created"] },
  { key: "accepted", label: "Store accepted", statuses: ["confirmed"] },
  { key: "packing", label: "Packing", statuses: ["preparing", "ready_for_pickup", "reached_pickup"] },
  { key: "onway", label: "On the way", statuses: ["picked_up", "reached_drop"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
]
const stepIndex = (status) => STEPS.findIndex((s) => s.statuses.includes(status))
const isCancelled = (status) => String(status || "").startsWith("cancelled")
const statusLabel = (status) =>
  isCancelled(status) ? "Cancelled" : status === "pending_payment" ? "Awaiting payment" : STEPS[stepIndex(status)]?.label || "Placed"
const storeName = (o) => o?.restaurantId?.restaurantName || o?.restaurantName || "Store"
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "")

function SignInPrompt() {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-20 text-center">
      <h1 className="text-[20px] font-black text-wh-text">Sign in to see your orders</h1>
      <Link to="/login" state={{ from: { pathname: "/quick/orders" } }} className={cx("mt-6 inline-flex h-11 items-center rounded-[10px] bg-wh-brand-ink px-6 text-[14px] font-bold text-white", focusRing)}>Sign in</Link>
    </div>
  )
}

export function OrdersList() {
  const [orders, setOrders] = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)

  useEffect(() => {
    quickAPI
      .orders(1)
      .then((d) => setOrders(d.data || d.orders || []))
      .catch((err) => {
        if (err?.response?.status === 401) setNeedsLogin(true)
        setOrders([])
      })
  }, [])

  if (needsLogin) return <SignInPrompt />
  return (
    <div className="mx-auto max-w-[760px] px-3 py-3 lg:px-6">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h1 className="text-[20px] font-black tracking-tight text-wh-text">Your quick orders</h1>
        <Link to={ALL_ORDERS_PATH} className={cx("inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-wh-link hover:underline", focusRing)}>
          <Receipt className="h-4 w-4" aria-hidden="true" />All orders
        </Link>
      </div>
      <p className="-mt-2 mb-3 px-1 text-[12px] text-wh-muted">Food, rides, services and shop orders are all in All orders.</p>
      {orders === null ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wh-muted" aria-label="Loading" /></div>
      ) : orders.length ? (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o._id}>
              <Link to={`/quick/orders/${o._id}`} className={cx("flex items-center gap-3 rounded-[10px] bg-wh-surface p-4 hover:shadow-md", focusRing)}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-wh-brand-50"><Package className="h-5 w-5 text-wh-brand-ink" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-wh-text">{storeName(o)}</span>
                  <span className="block truncate text-[12px] text-wh-muted">{(o.items || []).map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span>
                  <span className="block text-[12px] text-wh-muted">{when(o.createdAt)} · ₹{formatMoney(o.pricing?.total)}</span>
                </span>
                <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", isCancelled(o.orderStatus) ? "bg-[#FDECEE] text-wh-deal" : o.orderStatus === "delivered" ? "bg-[#E6F4EA] text-wh-success" : "bg-wh-brand-50 text-wh-brand-ink")}>
                  {statusLabel(o.orderStatus)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-wh-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-16 text-center text-[14px] text-wh-muted">No quick orders yet. <Link to="/quick" className="font-semibold text-wh-link">Start shopping</Link></p>
      )}
    </div>
  )
}

/**
 * Live updates for one order over the quick-commerce socket (/qc namespace).
 *
 * The tracking room is named after whichever id the rider app sends with its
 * position (the display id or the Mongo id), so the page joins under both.
 * A status change re-reads the order; a position only moves the rider. Polling
 * keeps the page right if the socket cannot connect.
 */
function useOrderLive(ids, onStatus, onPosition) {
  const key = ids.filter(Boolean).map(String).join(",")
  useEffect(() => {
    const token = localStorage.getItem("user_accessToken")
    const list = key ? key.split(",") : []
    if (!token || !list.length) return undefined
    let origin = window.location.origin
    try {
      origin = new URL(API_BASE_URL || "/api/v1", window.location.origin).origin
    } catch {
      // keep the page's own origin
    }
    const mine = (id) => list.includes(String(id))
    const socket = io(`${origin}/qc`, { path: "/socket.io/", transports: ["websocket", "polling"], auth: { token } })
    socket.on("connect", () => list.forEach((id) => socket.emit("join-tracking", id)))
    socket.on("order_status_update", (p) => {
      if (!p || mine(p.orderMongoId) || mine(p.orderId)) onStatus()
    })
    socket.on("location-update", (p) => {
      if (p?.orderId && !mine(p.orderId)) return
      const lat = Number(p?.lat ?? p?.boy_lat)
      const lng = Number(p?.lng ?? p?.boy_lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) onPosition({ lat, lng })
    })
    return () => {
      list.forEach((id) => socket.emit("leave-tracking", id))
      socket.disconnect()
    }
  }, [key, onStatus, onPosition])
}

// The rider is on the road (or heading to the store) only in these states.
const TRACKABLE = ["confirmed", "preparing", "ready_for_pickup", "reached_pickup", "picked_up", "reached_drop"]
const ROUTE_REFRESH_MS = 45000

/**
 * The road from the rider to their next stop, re-asked while they move. The
 * server cuts it from the rider's last known position; Directions is billed,
 * so it is refreshed on a slow timer and on each status change, not per ping.
 */
function useRiderRoute(orderId, active, statusKey) {
  const [route, setRoute] = useState(null)
  useEffect(() => {
    if (!active || !orderId) {
      setRoute(null)
      return undefined
    }
    let cancelled = false
    const load = () =>
      quickAPI
        .orderRoute(orderId)
        .then((r) => !cancelled && setRoute(r))
        .catch(() => {})
    load()
    const timer = setInterval(load, ROUTE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [orderId, active, statusKey])
  return route
}

export function OrderDetail() {
  const { orderId } = useParams()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [livePosition, setLivePosition] = useState(null)

  const refresh = useCallback(() => {
    quickAPI
      .order(orderId)
      .then((o) => {
        setOrder(o)
        setError("")
      })
      .catch((err) => setError(errorMessage(err, "This order could not be loaded.")))
  }, [orderId])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15000)
    return () => clearInterval(timer)
  }, [refresh])

  const status = order?.orderStatus || order?.status
  const riderAssigned = Boolean(order?.dispatch?.deliveryPartnerId)
  const tracking = riderAssigned && TRACKABLE.includes(status)
  useOrderLive([orderId, order?.orderId, order?.orderMongoId], refresh, setLivePosition)
  const route = useRiderRoute(orderId, tracking, status)

  const cancel = async () => {
    if (!window.confirm("Cancel this order?")) return
    setCancelling(true)
    try {
      await quickAPI.cancelOrder(orderId, "Cancelled by customer")
      refresh()
      toast.success("Order cancelled")
    } catch (err) {
      toast.error(errorMessage(err, "The order could not be cancelled."))
    } finally {
      setCancelling(false)
    }
  }

  if (error && !order) return <p className="px-4 py-16 text-center text-[14px] text-wh-muted">{error}</p>
  if (!order) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-wh-muted" aria-label="Loading" /></div>

  const cancelled = isCancelled(status)
  const current = stepIndex(status)
  const rider = order.dispatch?.deliveryPartnerId
  const riderName = rider?.name || rider?.fullName
  const riderPhone = rider?.phone || rider?.phoneNumber
  const eta = order.eta?.minutes
  const p = order.pricing || {}
  const storeAt = toLatLng(order.restaurantId?.location)
  const homeAt = toLatLng(order.deliveryAddress?.location || order.deliveryAddress)
  const riderAt = tracking ? livePosition || toLatLng(order.deliveryState?.currentLocation) || route?.origin || null : null
  const showMap = !cancelled && status !== "delivered" && status !== "pending_payment" && (storeAt || homeAt)

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-3 py-3 lg:px-6">
      {showMap ? (
        <section className="rounded-[10px] bg-wh-surface p-2" aria-label="Live map">
          <TrackingMap store={storeAt} home={homeAt} rider={riderAt} polyline={route?.polyline} />
          <p className="px-2 pb-1 pt-2 text-[12px] text-wh-muted">
            {riderAt
              ? route?.durationMins
                ? `Your delivery partner is about ${route.durationMins} min from ${route.target === "customer" ? "you" : "the store"}.`
                : "Your delivery partner's live position."
              : riderAssigned
                ? "Waiting for your delivery partner's location…"
                : "A delivery partner will be assigned shortly."}
          </p>
        </section>
      ) : null}

      <section className="rounded-[10px] bg-wh-surface p-4">
        <p className="text-[12px] text-wh-muted">Order {order.orderId || order.order_id}</p>
        <h1 className="mt-0.5 text-[22px] font-black tracking-tight text-wh-text">{statusLabel(status)}</h1>
        {!cancelled && status !== "delivered" && eta ? (
          <p className="mt-1 flex items-center gap-1 text-[14px] font-bold text-wh-success"><Clock className="h-4 w-4" aria-hidden="true" />Arriving in about {eta} min</p>
        ) : null}
        {cancelled && order.cancellationReason ? <p className="mt-1 text-[13px] text-wh-muted">{order.cancellationReason}</p> : null}

        {!cancelled ? (
          <ol className="mt-4 flex flex-col gap-3">
            {STEPS.map((s, i) => {
              const done = i <= current
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", done ? "bg-wh-success text-white" : "bg-[#F0F2F2] text-wh-muted")}>
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <span className={cx("text-[14px]", i === current ? "font-bold text-wh-text" : done ? "text-wh-text" : "text-wh-muted")}>{s.label}</span>
                </li>
              )
            })}
          </ol>
        ) : null}

        {order.handoverOtp ? (
          <p className="mt-4 flex items-center gap-2 rounded-[10px] bg-wh-brand-50 p-3 text-[14px] text-wh-text">
            <KeyRound className="h-4 w-4 text-wh-brand-ink" aria-hidden="true" />
            Share <strong className="tracking-widest">{order.handoverOtp}</strong> with the rider when your order arrives.
          </p>
        ) : null}

        {order.cancellation?.allowed ? (
          <button type="button" onClick={cancel} disabled={cancelling}
            className={cx("mt-4 h-10 w-full rounded-[10px] border border-wh-deal text-[14px] font-semibold text-wh-deal disabled:opacity-50", focusRing)}>
            {cancelling ? "Cancelling…" : "Cancel order"}
          </button>
        ) : null}
      </section>

      {riderName ? (
        <section className="flex items-center gap-3 rounded-[10px] bg-wh-surface p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-wh-brand-50"><Bike className="h-5 w-5 text-wh-brand-ink" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-wh-text">{riderName}</span>
            <span className="block text-[12px] text-wh-muted">Your delivery partner</span>
          </span>
          {riderPhone ? (
            <a href={`tel:${riderPhone}`} className={cx("flex h-10 w-10 items-center justify-center rounded-full border border-wh-border", focusRing)} aria-label={`Call ${riderName}`}>
              <Phone className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </section>
      ) : null}

      {status === "delivered" ? <RateOrder order={order} storeName={storeName(order)} riderName={riderName} onRated={refresh} /> : null}

      <section className="rounded-[10px] bg-wh-surface p-4">
        <p className="mb-3 flex items-center gap-2 text-[15px] font-bold text-wh-text"><Store className="h-4 w-4 text-wh-brand-ink" aria-hidden="true" />{storeName(order)}</p>
        <ul className="flex flex-col gap-1.5">
          {(order.items || []).map((i, idx) => (
            // A buy-one-get-one unit is its own line of the same product, so the
            // key needs the position; free lines (that and a free item) say so.
            <li key={`${i.itemId}-${i.variantId || ""}-${idx}`} className="flex justify-between text-[14px] text-wh-text">
              <span>{i.quantity} × {i.name}{i.variantName ? ` · ${i.variantName}` : ""}</span>
              {i.isBogoFree || i.isFreebie ? (
                <span className="font-semibold text-wh-success">{i.isFreebie ? "Free gift" : "Free"}</span>
              ) : (
                <span>₹{formatMoney((i.variantPrice || i.price) * i.quantity)}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="my-3 border-t border-wh-border" />
        {[["Delivery", p.deliveryFee], ["Surge (busy area)", p.surgeAmount], ["Platform fee", p.platformFee], ["Taxes", Number(p.tax || 0) + Number(p.deliveryFeeGst || 0)]].map(([l, v]) =>
          Number(v) ? <div key={l} className="flex justify-between text-[13px] text-wh-muted"><span>{l}</span><span>₹{formatMoney(v)}</span></div> : null,
        )}
        {Number(p.discount) ? <div className="flex justify-between text-[13px] text-wh-success"><span>Discount</span><span>−₹{formatMoney(p.discount)}</span></div> : null}
        {Number(p.bogoSavings) ? <div className="flex justify-between text-[13px] text-wh-success"><span>Buy 1 get 1 saving</span><span>₹{formatMoney(p.bogoSavings)}</span></div> : null}
        <div className="mt-1 flex justify-between text-[15px] font-bold text-wh-text"><span>Total</span><span>₹{formatMoney(p.total)}</span></div>
        <p className="mt-2 text-[12px] text-wh-muted">
          {order.payment?.method === "cash" ? "Pay cash on delivery" : order.payment?.status === "paid" ? "Paid online" : `Payment: ${order.payment?.status || "pending"}`}
          {" · "}{when(order.createdAt)}
        </p>
      </section>

      <Link to={SUPPORT_PATH} className={cx("flex items-center gap-3 rounded-[10px] bg-wh-surface p-4 hover:shadow-md", focusRing)}>
        <HelpCircle className="h-5 w-5 text-wh-brand-ink" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-wh-text">Need help with this order?</span>
          <span className="block text-[12px] text-wh-muted">Raise a ticket with order {order.orderId || order.order_id} in the help centre</span>
        </span>
        <ChevronRight className="h-4 w-4 text-wh-muted" aria-hidden="true" />
      </Link>
    </div>
  )
}
