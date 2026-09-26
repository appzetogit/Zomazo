import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Loader2 } from "lucide-react"
import { adminAPI } from "@store/api"
import { useAdminBase } from "@store/components/admin/useAdminPanel"
import { SummaryCard, formatCurrency, formatDateTime, errorMessage } from "../reports/reportShared"

const label = (s) => String(s || "").replace(/_/g, " ")

/** One checkout: its payment, how the price was split, and each seller's order. */
export default function CheckoutDetail() {
  const { checkoutId } = useParams()
  const base = useAdminBase()
  const [ck, setCk] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    adminAPI.getCheckoutAdmin(checkoutId)
      .then((res) => setCk(res?.data?.data || null))
      .catch((e) => toast.error(errorMessage(e, "Failed to load the checkout")))
      .finally(() => setLoading(false))
  }, [checkoutId])

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
  if (!ck) return <div className="p-8 text-center text-slate-500">Checkout not found</div>

  const p = ck.pricing || {}
  const addr = ck.address || {}

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Link to={`${base}/checkouts`} className="text-sm text-slate-600 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Checkouts</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Checkout {ck.checkoutId}</h1>
        <p className="text-sm text-slate-500 capitalize">{formatDateTime(ck.createdAt)} · {ck.mode} · {label(ck.status)}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryCard label="Grand total" value={formatCurrency(p.grandTotal)} />
        <SummaryCard label="Payment" value={<span className="capitalize">{label(ck.payment?.method)}</span>} hint={label(ck.payment?.status)} />
        <SummaryCard label="Coupon" value={ck.coupon?.code || p.couponCode || "—"} hint={p.discount ? `-${formatCurrency(p.discount)}` : ""} />
        <SummaryCard label="Coins" value={p.coinsUsed || 0} hint={p.coinsDiscount ? `-${formatCurrency(p.coinsDiscount)}` : ""} />
        <SummaryCard label="Orders" value={ck.split?.orders || 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-1">
          <h2 className="font-semibold text-slate-700">Customer</h2>
          <div>{ck.customer?.name || "—"} · {ck.customer?.phone}</div>
          {ck.customer?.email && <div className="text-slate-500">{ck.customer.email}</div>}
          <div className="text-slate-500">{[addr.street, addr.city, addr.state, addr.zipCode].filter(Boolean).join(", ")}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-1">
          <h2 className="font-semibold text-slate-700">Payment and split</h2>
          {ck.payment?.gatewayPaymentId && <div className="text-xs text-slate-500">Gateway payment {ck.payment.gatewayPaymentId}</div>}
          {ck.payment?.paidAt && <div className="text-xs text-slate-500">Paid {formatDateTime(ck.payment.paidAt)}</div>}
          <table className="w-full text-xs">
            <tbody>
              {[
                ["Subtotal", p.subtotal, ck.split?.subtotal],
                ["Delivery fees", p.deliveryFee, ck.split?.deliveryFees],
                ["Coupon discount", p.discount, ck.split?.couponShares],
                ["Coins discount", p.coinsDiscount, ck.split?.coinsShares],
                ["Total", p.grandTotal, ck.split?.total],
              ].map(([l, a, b]) => (
                <tr key={l} className="border-t border-slate-100">
                  <td className="py-1">{l}</td>
                  <td className="text-right">{formatCurrency(a)}</td>
                  <td className="text-right text-slate-500">orders: {formatCurrency(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>{["Order", "Seller", "Items", "Subtotal", "Coupon share", "Coins share", "Total", "Status", "Shipment / rider"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(ck.orders || []).map((o) => (
              <tr key={o._id}>
                <td className="px-3 py-2">
                  <Link className="text-blue-600" to={`${base}/orders/all?orderId=${encodeURIComponent(o.orderId)}`}>#{o.orderId}</Link>
                  <div className="text-xs text-slate-500 capitalize">{label(o.payment?.method)} · {label(o.payment?.status)}</div>
                </td>
                <td className="px-3 py-2">{o.seller?.name || "—"}</td>
                <td className="px-3 py-2">{o.itemCount}</td>
                <td className="px-3 py-2">{formatCurrency(o.pricing?.subtotal)}</td>
                <td className="px-3 py-2">{formatCurrency(o.pricing?.couponShare)}</td>
                <td className="px-3 py-2">{formatCurrency(o.pricing?.coinsShare)}{o.pricing?.coinsUsed ? <span className="text-xs text-slate-500"> ({o.pricing.coinsUsed})</span> : null}</td>
                <td className="px-3 py-2">{formatCurrency(o.pricing?.total)}</td>
                <td className="px-3 py-2 capitalize">{label(o.status)}</td>
                <td className="px-3 py-2 text-xs">
                  {o.shipment ? (
                    <><div>{o.shipment.courierName} <span className="font-mono">{o.shipment.awb || "—"}</span></div><div className="capitalize text-slate-500">{label(o.shipment.status)}</div></>
                  ) : o.rider ? (
                    <div>{o.rider.name} · {o.rider.phone}</div>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
