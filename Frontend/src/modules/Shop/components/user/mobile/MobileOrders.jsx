import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Check, ChevronRight, Package, RotateCcw, Store, Truck, Zap } from "lucide-react"
import { orderAPI } from "@/services/api"
import { mediaUrl } from "../desktop/desktopCart"
import MobileTopBar from "./MobileTopBar"

/**
 * "My Orders" from the mobile mockup (screen 6): status tabs, one card per
 * store's order with its items, a four-step tracker and the next thing to do
 * (track it, buy it again, or look at the details).
 */

const TABS = ["All", "Ordered", "Shipped", "Delivered", "Returns"]

const CANCELLED = ["cancelled_by_user", "cancelled_by_seller", "cancelled_by_admin"]
const MOVING = ["picked_up", "reached_drop"]

const statusOf = (o) => String(o?.orderStatus || o?.status || "")
const isCourier = (o) => o?.fulfilmentMode === "standard"

/** Which tab an order belongs to, besides "All" and "Returns". */
function bucketOf(o) {
  const s = statusOf(o)
  if (CANCELLED.includes(s)) return "Cancelled"
  if (s === "delivered") return "Delivered"
  if (MOVING.includes(s) || (isCourier(o) && o?.shipment?.awb)) return "Shipped"
  return "Ordered"
}

/** 0 placed, 1 packed, 2 on the way, 3 delivered. */
function stepOf(o) {
  const s = statusOf(o)
  if (s === "delivered") return 3
  const courier = String(o?.shipment?.status || o?.shipment?.currentStatus || "").toLowerCase()
  if (s === "reached_drop" || courier.includes("out_for_delivery") || courier.includes("out for delivery")) return 2
  if (s === "picked_up" || (isCourier(o) && o?.shipment?.awb)) return isCourier(o) ? 1.5 : 2
  if (["preparing", "ready_for_pickup", "reached_pickup"].includes(s)) return 1
  return 0
}

const stepsFor = (o) => (isCourier(o) ? ["Ordered", "Shipped", "Out for delivery", "Delivered"] : ["Placed", "Packed", "On the way", "Delivered"])

const RETURN_LABEL = {
  requested: "Return requested",
  approved: "Return approved, pickup soon",
  rejected: "Return declined",
  received: "Return received, refund on its way",
  refunded: "Refunded",
}

function headline(o) {
  const s = statusOf(o)
  if (o?.latestReturn) return RETURN_LABEL[o.latestReturn.status] || "Return in progress"
  if (s === "pending_payment") return "Waiting for payment"
  if (s === "cancelled_by_user") return "You cancelled this order"
  if (CANCELLED.includes(s)) return "Cancelled"
  if (s === "delivered") {
    const at = o?.deliveryState?.deliveredAt || o?.deliveredAt || o?.updatedAt
    return at ? `Delivered on ${new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Delivered"
  }
  const step = stepOf(o)
  if (isCourier(o)) return step >= 2 ? "Out for delivery" : step >= 1.5 ? "Shipped" : "Ordered, packing soon"
  return step >= 2 ? "On the way" : step >= 1 ? "Being packed" : "Order placed"
}

function Tracker({ order }) {
  const steps = stepsFor(order)
  const at = stepOf(order)
  const done = (i) => (isCourier(order) && i === 1 ? at >= 1.5 : at >= i)
  return (
    <ol className="mt-3 flex items-start" aria-label="Order progress">
      {steps.map((label, i) => (
        <li key={label} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 ? (
            <span
              aria-hidden="true"
              className={`absolute right-1/2 top-[9px] h-[3px] w-full rounded-full ${done(i) ? "bg-[#1E9E48]" : "bg-gray-200"}`}
            />
          ) : null}
          <span
            className={`relative z-[1] flex h-5 w-5 items-center justify-center rounded-full ${
              done(i) ? "bg-[#1E9E48] text-white" : "border-2 border-gray-300 bg-white"
            }`}
          >
            {done(i) ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : null}
          </span>
          <span className={`mt-1 text-[10px] leading-tight ${done(i) ? "font-semibold text-gray-900" : "text-gray-500"}`}>{label}</span>
        </li>
      ))}
    </ol>
  )
}

function OrderCard({ order }) {
  const navigate = useNavigate()
  const seller = order?.sellerId && typeof order.sellerId === "object" ? order.sellerId : {}
  const items = order?.items || []
  const first = items[0] || {}
  const s = statusOf(order)
  const cancelled = CANCELLED.includes(s)
  const courier = isCourier(order)
  const id = String(order._id || order.id)
  const shortId = String(order.order_id || order.orderId || id).slice(-8).toUpperCase()
  const total = Number(order?.pricing?.total ?? order?.total ?? 0)
  const modePath = (path) => (courier ? path : `/quick${path}`)
  const tone = cancelled || order?.latestReturn?.status === "rejected" ? "text-[#CC0C39]" : s === "delivered" ? "text-[#1E9E48]" : "text-[#C2410C]"

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#FFF1E7]">
          {seller.profileImage ? (
            <img src={mediaUrl(seller.profileImage)} alt="" className="h-full w-full object-cover" />
          ) : (
            <Store className="h-4 w-4 text-[#EA580C]" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-gray-900">{seller.sellerName || "Store"}</span>
          <span className="block text-[11px] text-gray-500">
            #{shortId} · {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-700">
          {courier ? <Truck className="h-3 w-3" aria-hidden="true" /> : <Zap className="h-3 w-3" aria-hidden="true" />}
          {courier ? "Shop" : "Quick"}
        </span>
      </header>

      <Link to={`/orders/${id}/details`} className="flex gap-3 px-3 pt-3">
        <span className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
          {first.image ? (
            <img src={mediaUrl(first.image)} alt="" className="h-full w-full object-cover" />
          ) : (
            <Package className="absolute inset-0 m-auto h-6 w-6 text-gray-400" aria-hidden="true" />
          )}
          {items.length > 1 ? (
            <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/70 px-1 text-[10px] font-bold text-white">+{items.length - 1}</span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] font-bold ${tone}`}>{headline(order)}</span>
          <span className="mt-0.5 block truncate text-[13px] text-gray-900">
            {first.name}
            {items.length > 1 ? ` and ${items.length - 1} more` : ""}
          </span>
          <span className="block text-[12px] text-gray-500">
            {[first.variantName, `Qty ${items.reduce((n, i) => n + (Number(i.quantity) || 1), 0)}`, `₹${total.toLocaleString("en-IN")}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <ChevronRight className="mt-5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </Link>

      <div className="px-3">{!cancelled && s !== "pending_payment" && !order.latestReturn ? <Tracker order={order} /> : null}</div>

      <div className="mt-3 flex gap-2 border-t border-gray-100 p-3">
        {!cancelled && s !== "delivered" ? (
          <Link
            to={`/orders/${id}`}
            className="flex h-9 flex-1 items-center justify-center rounded-lg bg-[#EA580C] text-[13px] font-bold text-white active:scale-[0.98]"
          >
            Track Order
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => navigate(`${modePath("/cart")}?reorder=${encodeURIComponent(id)}`)}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#EA580C] text-[13px] font-bold text-white active:scale-[0.98]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Buy Again
          </button>
        )}
        <Link
          to={`/orders/${id}/details`}
          className="flex h-9 flex-1 items-center justify-center rounded-lg border border-gray-300 text-[13px] font-bold text-gray-800 active:bg-gray-50"
        >
          View Details
        </Link>
      </div>
    </article>
  )
}

export default function MobileOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState("All")

  useEffect(() => {
    let cancelled = false
    orderAPI
      .getOrders({ page: 1, limit: 50 })
      .then((res) => {
        const d = res?.data?.data
        const list = d?.orders || d?.data || (Array.isArray(d) ? d : [])
        if (!cancelled) setOrders(Array.isArray(list) ? list : [])
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo(() => {
    const c = { All: orders.length, Returns: 0 }
    for (const o of orders) {
      c[bucketOf(o)] = (c[bucketOf(o)] || 0) + 1
      if (o.latestReturn) c.Returns += 1
    }
    return c
  }, [orders])

  const shown = orders.filter((o) => (tab === "All" ? true : tab === "Returns" ? !!o.latestReturn : bucketOf(o) === tab))

  return (
    <div className="min-h-screen bg-[#F7F7F8] pb-8 lg:hidden">
      <MobileTopBar title="My Orders" subtitle={loading ? "" : `${orders.length} order${orders.length === 1 ? "" : "s"}`} actions={["search", "cart"]} />
      <div className="sticky top-14 z-30 flex gap-2 overflow-x-auto border-b border-gray-100 bg-white px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold ${tab === t ? "bg-[#EA580C] text-white" : "bg-gray-100 text-gray-700"}`}
          >
            {t}
            {!loading && counts[t] ? <span className={`ml-1 text-[11px] ${tab === t ? "text-white/80" : "text-gray-500"}`}>{counts[t]}</span> : null}
          </button>
        ))}
      </div>

      <div className="space-y-3 px-3 pt-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white p-3" role="status" aria-label="Loading orders">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200/80" />
              <div className="mt-3 flex gap-3">
                <div className="h-16 w-14 animate-pulse rounded-lg bg-gray-200/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200/80" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200/80" />
                </div>
              </div>
              <div className="mt-4 h-9 animate-pulse rounded-lg bg-gray-200/80" />
            </div>
          ))
        ) : failed ? (
          <p className="rounded-2xl bg-white p-8 text-center text-[14px] text-gray-600">Couldn&apos;t load your orders. Pull down or try again in a moment.</p>
        ) : shown.length ? (
          shown.map((o) => <OrderCard key={o._id || o.id} order={o} />)
        ) : (
          <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF1E7]">
              <Package className="h-7 w-7 text-[#EA580C]" aria-hidden="true" />
            </span>
            <p className="mt-3 text-[16px] font-bold text-gray-900">
              {tab === "All" ? "No orders yet" : tab === "Returns" ? "No returns" : `Nothing ${tab.toLowerCase()} right now`}
            </p>
            {tab === "All" ? (
              <Link to="/" className="mt-4 rounded-xl bg-[#EA580C] px-5 py-2.5 text-[14px] font-bold text-white">
                Start shopping
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
