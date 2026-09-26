import crypto from 'crypto';
import mongoose from 'mongoose';
import { Order } from '../../../modules/commerce/orders/models/order.model.js';
import * as orderTransactionService from '../../../modules/commerce/orders/services/orderTransaction.service.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * ✅ NEW: Centralized Razorpay Webhook Handler (Core Layer)
 * Manages atomic updates for order payments and refunds across all modules.
 */
export const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = config.razorpayWebhookSecret;

    // 1. Verify Signature using raw body buffer
    if (!signature || !secret || !req.rawBody) {
        logger.warn('Razorpay Webhook: Missing signature or rawBody buffer.');
        return res.status(400).send('Invalid signature');
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    if (expected !== signature) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body;
    logger.info(`Razorpay Webhook Received: ${event}`);

    try {
        // --- 🟢 Handle Payment Captured (Success) ---
        if (event === 'payment.captured') {
            const paymentObj = payload.payment.entity;
            const rzOrderId = paymentObj.order_id;
            const rzPaymentId = paymentObj.id;

            // A split checkout's payment releases all of its stores' orders.
            const { handleCheckoutPaymentCaptured } = await import('../../../modules/commerce/orders/services/orderSplit.service.js');
            if (await handleCheckoutPaymentCaptured({ rzOrderId, rzPaymentId, amountPaise: paymentObj.amount, payment: paymentObj })) {
                return res.status(200).json({ status: 'ok' });
            }

            // Cross-check the captured amount against the order total before marking paid.
            const existingOrder = await Order.findOne({ "payment.razorpay.orderId": rzOrderId })
                .select('pricing payment orderStatus')
                .lean();
            if (existingOrder) {
                const expectedPaise = Math.round((Number(existingOrder.pricing?.total) || 0) * 100);
                const paidPaise = Number(paymentObj.amount);
                if (!Number.isFinite(paidPaise) || paidPaise !== expectedPaise) {
                    logger.error(
                        `Webhook [payment.captured]: AMOUNT MISMATCH for RZ-Order ${rzOrderId} — paid ${paidPaise} paise, expected ${expectedPaise} paise. Order NOT marked paid.`,
                    );
                    if (String(existingOrder.payment?.status || '').toLowerCase() !== 'paid') {
                        await Order.updateOne(
                            { _id: existingOrder._id, "payment.status": { $ne: 'paid' } },
                            { $set: { "payment.status": 'failed', "payment.razorpay.paymentId": rzPaymentId } },
                        );
                    }
                    return res.status(200).json({ status: 'ok' });
                }
            }

            // Atomic update to mark as paid if not already
            const order = await Order.findOneAndUpdate(
                { 
                    "payment.razorpay.orderId": rzOrderId, 
                    "payment.status": { $ne: 'paid' } 
                },
                { 
                    $set: { 
                        "payment.status": 'paid', 
                        "payment.razorpay.paymentId": rzPaymentId 
                    } 
                },
                { new: true }
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
                        logger.error(`[CRITICAL] Webhook could not release paid order ${order._id}: ${releaseErr.message}`);
                    }
                }
                try {
                    await orderTransactionService.updateTransactionStatus(order._id, 'captured', {
                        status: 'captured',
                        razorpayPaymentId: rzPaymentId,
                        note: 'Payment status synced via Webhook (payment.captured)'
                    });
                } catch (ledgerErr) {
                    logger.error(`Webhook Ledger Error (Order ${order.orderId}): ${ledgerErr.message}`);
                }
                logger.info(`Webhook [payment.captured]: Synced Order ${order.orderId} (Status=paid)`);
            } else {
                // ✅ ADDED: Log warn if order not found but payment was captured
                logger.warn(`Webhook [payment.captured]: Order not found or already paid for RZ-Order: ${rzOrderId}`);
            }

            // The paying card/UPI joins the order's first-order claim, whether
            // this webhook or the app's verify released it (recording is idempotent).
            if (existingOrder) {
                try {
                    const { recordPaymentFingerprint } = await import('../../../modules/commerce/orders/services/firstOrderGuard.service.js');
                    await recordPaymentFingerprint({ orderId: existingOrder._id, payment: paymentObj });
                } catch (fpErr) {
                    logger.warn(`Webhook: first-order payment fingerprint for order ${existingOrder._id} failed: ${fpErr?.message || fpErr}`);
                }
            }
        }

        // --- 🔴 Handle Refund Processed ---
        if (event === 'refund.processed') {
            const refundObj = payload.refund.entity;
            const rzPaymentId = refundObj.payment_id;
            const rzRefundId = refundObj.id;
            const refundAmount = refundObj.amount / 100; // to major unit

            // Sync refund fields in the order
            const order = await Order.findOneAndUpdate(
                { 
                    "payment.razorpay.paymentId": rzPaymentId,
                    "payment.refund.status": { $ne: 'processed' }
                },
                { 
                    $set: { 
                        "payment.status": 'refunded',
                        "payment.refund": {
                            status: 'processed',
                            amount: refundAmount,
                            refundId: rzRefundId,
                            processedAt: new Date()
                        }
                    } 
                },
                { new: true }
            );

            if (order) {
                logger.info(`Webhook [refund.processed]: Synced Order ${order.orderId} (Refunded)`);
            } else {
                // ✅ ADDED: Log warn if order not found for refund
                logger.warn(`Webhook [refund.processed]: Order not found or already refunded for RZ-Payment: ${rzPaymentId}`);
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        logger.error(`Razorpay Webhook Logic Error: ${err.message}`);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
