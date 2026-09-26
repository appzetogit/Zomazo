import { useEffect, useState } from "react"
import { toast } from "sonner"
import { orderAPI } from "@store/api"
import { initRazorpayPayment } from "@store/utils/razorpay"
import { getCompanyNameAsync } from "@store/utils/businessSettings"

/** Matches the server's hold on an unpaid online checkout. */
const HOLD_MS = 30 * 60 * 1000

const pad = (n) => String(n).padStart(2, "0")

/**
 * "Complete payment" for an online order whose payment failed or was closed.
 * Shown only while the order is pending_payment and part of a checkout; the
 * countdown runs to the end of the 30-minute hold, after which the items are
 * released and the order is gone.
 */
export default function CompletePaymentCard({ order, onPaid }) {
  const checkoutId = order?.orderGroupId || ""
  const isPending = String(order?.orderStatus || order?.status || "").toLowerCase() === "pending_payment"
  const [holdEndsAt, setHoldEndsAt] = useState(() =>
    order?.createdAt ? new Date(order.createdAt).getTime() + HOLD_MS : 0,
  )
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!isPending) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isPending])

  if (!isPending || !checkoutId) return null

  const left = Math.max(0, holdEndsAt - now)
  const isOver = expired || (holdEndsAt > 0 && left <= 0)

  const pay = async () => {
    setBusy(true)
    try {
      const res = await orderAPI.retryCheckoutPayment(checkoutId)
      const data = res?.data?.data || {}
      if (data.holdEndsAt) setHoldEndsAt(new Date(data.holdEndsAt).getTime())
      const rz = data.razorpay
      if (!rz?.orderId) throw new Error("Online payment could not be started. Please try again.")
      await initRazorpayPayment({
        key: rz.key,
        amount: rz.amount,
        currency: rz.currency || "INR",
        order_id: rz.orderId,
        name: await getCompanyNameAsync(),
        description: `Order ${checkoutId}`,
        handler: async (response) => {
          try {
            await orderAPI.verifyCheckoutPayment(checkoutId, {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
            toast.success("Payment received. Your order is confirmed.")
            onPaid?.()
          } catch (err) {
            toast.error(
              err?.response?.data?.message ||
                "We couldn't confirm your payment yet. If money was taken, your order will be confirmed shortly.",
            )
          } finally {
            setBusy(false)
          }
        },
        // Closing the sheet keeps the order held; the customer can try again until the timer ends.
        onClose: () => setBusy(false),
      })
    } catch (err) {
      if (err?.response?.status === 409) {
        const reason = err?.response?.data?.data?.reason
        if (reason === "hold_expired") setExpired(true)
        if (reason === "already_paid") onPaid?.()
      }
      toast.error(err?.response?.data?.message || err?.message || "Could not start the payment")
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 space-y-2">
      {isOver ? (
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          The time to pay for this order has run out and the items were released. Please place the order again.
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Payment not completed</p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            We are holding your items for{" "}
            <strong>
              {pad(Math.floor(left / 60000))}:{pad(Math.floor((left % 60000) / 1000))}
            </strong>
            . Pay now to confirm the order.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={pay}
            className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold disabled:opacity-60"
          >
            {busy ? "Opening payment..." : "Complete payment"}
          </button>
        </>
      )}
    </div>
  )
}
