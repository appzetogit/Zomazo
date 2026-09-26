import { Order } from '../../../modules/commerce/orders/models/order.model.js';
import * as orderTransactionService from '../../../modules/commerce/orders/services/orderTransaction.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * E-commerce's share of the platform's ONE Razorpay webhook.
 *
 * The standalone app had its own HTTP handler. Razorpay delivers each event to
 * one URL, and the platform's is core/payments/controllers/razorpayWebhook
 * .controller.js -- so a second endpoint here would simply never be called, and
 * a shop order paid by a customer who then closed the app would never go live.
 * The platform handler verifies the signature and, when neither food nor
 * quick-commerce owns the event, offers it here.
 *
 * Returns true when an e-commerce order or checkout owned the event (whether or
 * not anything changed), false when it belongs to nobody here.
 */
export const handleEcomRazorpayEvent = async (event, payload) => {
    if (event === 'payment.captured') {
        const paymentObj = payload?.payment?.entity || {};
        const rzOrderId = paymentObj.order_id;
        const rzPaymentId = paymentObj.id;
        if (!rzOrderId) return false;

        // A split checkout's payment releases all of its stores' orders.
        const { handleCheckoutPaymentCaptured } = await import('../../../modules/commerce/orders/services/orderSplit.service.js');
        if (await handleCheckoutPaymentCaptured({ rzOrderId, rzPaymentId, amountPaise: paymentObj.amount, payment: paymentObj })) {
            return true;
        }

        // Cross-check the captured amount against the order total before marking paid.
        const existingOrder = await Order.findOne({ 'payment.razorpay.orderId': rzOrderId })
            .select('pricing payment orderStatus')
            .lean();
        if (!existingOrder) return false;

        const expectedPaise = Math.round((Number(existingOrder.pricing?.total) || 0) * 100);
        const paidPaise = Number(paymentObj.amount);
        if (!Number.isFinite(paidPaise) || paidPaise !== expectedPaise) {
            logger.error(
                `Ecom webhook [payment.captured]: AMOUNT MISMATCH for RZ-Order ${rzOrderId} — paid ${paidPaise} paise, expected ${expectedPaise} paise. Order NOT marked paid.`,
            );
            if (String(existingOrder.payment?.status || '').toLowerCase() !== 'paid') {
                await Order.updateOne(
                    { _id: existingOrder._id, 'payment.status': { $ne: 'paid' } },
                    { $set: { 'payment.status': 'failed', 'payment.razorpay.paymentId': rzPaymentId } },
                );
            }
            return true;
        }

        // Atomic update to mark as paid if not already
        const order = await Order.findOneAndUpdate(
            { 'payment.razorpay.orderId': rzOrderId, 'payment.status': { $ne: 'paid' } },
            { $set: { 'payment.status': 'paid', 'payment.razorpay.paymentId': rzPaymentId } },
            { new: true },
        );

        if (order) {
            // Marking the payment paid is not enough: the order also has to go
            // live (acceptance clock, ledger, seller told), or it sits in
            // pending_payment until the stale-payment sweep deletes a paid order.
            if (order.orderStatus === 'pending_payment') {
                try {
                    const { releasePaidOrder } = await import('../../../modules/commerce/orders/services/order.service.js');
                    await releasePaidOrder(order, { byRole: 'SYSTEM', razorpayPaymentId: rzPaymentId, note: 'Payment confirmed by Razorpay' });
                } catch (releaseErr) {
                    logger.error(`[CRITICAL] Ecom webhook could not release paid order ${order._id}: ${releaseErr.message}`);
                }
            }
            try {
                await orderTransactionService.updateTransactionStatus(order._id, 'captured', {
                    status: 'captured',
                    razorpayPaymentId: rzPaymentId,
                    note: 'Payment status synced via Webhook (payment.captured)',
                });
            } catch (ledgerErr) {
                logger.error(`Ecom webhook ledger error (Order ${order.orderId}): ${ledgerErr.message}`);
            }
            logger.info(`Ecom webhook [payment.captured]: Synced Order ${order.orderId} (Status=paid)`);
        }

        // The paying card/UPI joins the order's first-order claim, whether this
        // webhook or the app's verify released it (recording is idempotent).
        try {
            const { recordPaymentFingerprint } = await import('../../../modules/commerce/orders/services/firstOrderGuard.service.js');
            await recordPaymentFingerprint({ orderId: existingOrder._id, payment: paymentObj });
        } catch (fpErr) {
            logger.warn(`Ecom webhook: first-order payment fingerprint for order ${existingOrder._id} failed: ${fpErr?.message || fpErr}`);
        }
        return true;
    }

    if (event === 'refund.processed') {
        const refundObj = payload?.refund?.entity || {};
        const rzPaymentId = refundObj.payment_id;
        if (!rzPaymentId) return false;

        const owned = await Order.exists({ 'payment.razorpay.paymentId': rzPaymentId });
        if (!owned) return false;

        const order = await Order.findOneAndUpdate(
            { 'payment.razorpay.paymentId': rzPaymentId, 'payment.refund.status': { $ne: 'processed' } },
            {
                $set: {
                    'payment.status': 'refunded',
                    'payment.refund': {
                        status: 'processed',
                        amount: refundObj.amount / 100,
                        refundId: refundObj.id,
                        processedAt: new Date(),
                    },
                },
            },
            { new: true },
        );
        if (order) logger.info(`Ecom webhook [refund.processed]: Synced Order ${order.orderId} (Refunded)`);
        return true;
    }

    return false;
};
