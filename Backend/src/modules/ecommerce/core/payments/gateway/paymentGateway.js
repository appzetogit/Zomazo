/**
 * The payment gateway seam. Order, checkout and wallet code talk to Razorpay
 * through `razorpay.helper.js` today; new code (and the reconciliation report)
 * goes through `getPaymentGateway()` so a second provider is one adapter away.
 *
 * A gateway implements:
 *   name                                   'razorpay'
 *   isConfigured()                         boolean
 *   publicKey()                            key the client SDK needs
 *   createOrder({amount, currency, receipt, notes})  -> {id, amount, currency}   (amount in rupees)
 *   verifySignature({orderId, paymentId, signature}) -> boolean
 *   fetchPayment(paymentId)                -> {id, orderId, amount, status, method, capturedAt}
 *   refund({paymentId, amount, notes})     -> {success, refundId, status, error}
 */
import * as rzp from '../../../modules/commerce/orders/helpers/razorpay.helper.js';

const toRupees = (paise) => Math.round(Number(paise || 0)) / 100;

export const razorpayGateway = {
    name: 'razorpay',
    isConfigured: () => rzp.isRazorpayConfigured(),
    publicKey: () => rzp.getRazorpayKeyId(),
    async createOrder({ amount, currency = 'INR', receipt = '', notes } = {}) {
        const o = await rzp.createRazorpayOrder(Math.round(Number(amount) * 100), currency, receipt, notes);
        return { id: o.id, amount: toRupees(o.amount), currency: o.currency };
    },
    verifySignature: ({ orderId, paymentId, signature }) => rzp.verifyPaymentSignature(orderId, paymentId, signature),
    async fetchPayment(paymentId) {
        const p = await rzp.fetchRazorpayPayment(paymentId);
        return {
            id: p.id,
            orderId: p.order_id || null,
            amount: toRupees(p.amount),
            refunded: toRupees(p.amount_refunded),
            status: p.status,
            method: p.method || null,
            capturedAt: p.created_at ? new Date(p.created_at * 1000) : null,
        };
    },
    refund: ({ paymentId, amount }) => rzp.initiateRazorpayRefund(paymentId, amount),
};

const gateways = { razorpay: razorpayGateway };

export function getPaymentGateway(name = process.env.PAYMENT_GATEWAY || 'razorpay') {
    const gateway = gateways[String(name).toLowerCase()];
    if (!gateway) throw new Error(`Unknown payment gateway: ${name}`);
    return gateway;
}

/** For tests and future adapters. */
export function registerPaymentGateway(gateway) {
    gateways[gateway.name] = gateway;
}
