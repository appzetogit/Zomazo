import { Order } from '../../modules/commerce/orders/models/order.model.js';
import { Checkout } from '../../modules/commerce/orders/models/checkout.model.js';
import { getPaymentGateway } from './gateway/paymentGateway.js';
import { logger } from '../../utils/logger.js';

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Compares what we recorded as paid online against what the gateway says.
 * A split checkout is one payment, so it is checked once, not per store.
 *
 * Each row is `ok`, `amount_mismatch`, `not_captured`, `missing_payment_id`
 * or `gateway_error`.
 */
export async function reconcilePayments({ from, to, limit = 500 } = {}) {
    const gateway = getPaymentGateway();
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    const when = Object.keys(range).length ? { createdAt: range } : {};

    const checkouts = await Checkout.find({ ...when, 'payment.method': 'razorpay', 'payment.status': 'paid' })
        .select('checkoutId pricing.grandTotal payment createdAt').sort({ createdAt: -1 }).limit(limit).lean();
    const orders = await Order.find({
        ...when,
        checkoutId: null,
        'payment.method': 'razorpay',
        'payment.status': { $in: ['paid', 'refunded'] },
    }).select('orderId pricing.total payment createdAt').sort({ createdAt: -1 }).limit(limit).lean();

    const records = [
        ...checkouts.map((c) => ({ kind: 'checkout', ref: c.checkoutId, expected: c.pricing?.grandTotal, paymentId: c.payment?.gatewayPaymentId, createdAt: c.createdAt })),
        ...orders.map((o) => ({ kind: 'order', ref: o.orderId || String(o._id), expected: o.payment?.amountDue ?? o.pricing?.total, paymentId: o.payment?.razorpay?.paymentId, createdAt: o.createdAt })),
    ];

    const rows = [];
    for (const r of records) {
        const row = { ...r, expected: round2(r.expected), captured: null, status: 'ok' };
        if (!r.paymentId) {
            row.status = 'missing_payment_id';
        } else if (!gateway.isConfigured()) {
            row.status = 'gateway_error';
            row.error = 'gateway not configured';
        } else {
            try {
                const p = await gateway.fetchPayment(r.paymentId);
                row.captured = p.amount;
                row.gatewayStatus = p.status;
                if (p.status !== 'captured' && p.status !== 'refunded') row.status = 'not_captured';
                else if (Math.abs(p.amount - row.expected) > 0.01) row.status = 'amount_mismatch';
            } catch (err) {
                logger.warn(`reconcile ${r.paymentId}: ${err.message}`);
                row.status = 'gateway_error';
                row.error = err.message;
            }
        }
        rows.push(row);
    }

    const summary = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    return {
        gateway: gateway.name,
        checked: rows.length,
        expectedTotal: round2(rows.reduce((s, r) => s + r.expected, 0)),
        capturedTotal: round2(rows.reduce((s, r) => s + (r.captured || 0), 0)),
        summary,
        issues: rows.filter((r) => r.status !== 'ok'),
        rows,
    };
}
