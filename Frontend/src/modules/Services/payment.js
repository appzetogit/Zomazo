import { initRazorpayPayment } from "@food/utils/razorpay"
import { servicesAPI } from "./api"

/**
 * Pay a booking's current total online.
 *
 * The server makes a Razorpay order for what the booking costs NOW (after the
 * bill, if the professional has billed), and on return checks the captured
 * amount against it -- so the same call serves paying at checkout and paying
 * the final bill.
 *
 * Resolves "paid" or "dismissed" (the customer closed the sheet; the booking
 * stands, unpaid, and can be paid from its page). Rejects when the payment
 * could not be started or the server could not verify it.
 */
export async function payForBooking(bookingId, { prefill, description } = {}) {
  const order = await servicesAPI.createPaymentOrder(bookingId)
  if (!order?.orderId) throw new Error("Could not start the payment. Please try again.")

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    initRazorpayPayment({
      key: order.key,
      amount: Math.round(Number(order.amount || 0) * 100),
      currency: order.currency || "INR",
      order_id: order.orderId,
      name: "Services",
      description: description || "Service booking",
      prefill,
      notes: { bookingId: String(bookingId) },
      handler: async (response) => {
        try {
          await servicesAPI.verifyPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          })
          done(resolve, "paid")
        } catch (err) {
          done(reject, err)
        }
      },
      // A failed attempt leaves Razorpay's sheet open with a retry, so it settles
      // nothing: the customer either pays on the retry or closes the sheet.
      onError: () => {},
      onClose: () => done(resolve, "dismissed"),
    }).catch((err) => done(reject, err))
  })
}
