import mongoose from 'mongoose';
import { Checkout } from '../models/checkout.model.js';
import { Order } from '../models/order.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { restoreOrderStock } from './inventory.service.js';
import { applyCheckoutShare, calculateOrderPricing, loadActiveFeeSettings, resolveCoupon } from './order-pricing.service.js';
import { normalizeDeliveryAddress } from '../../shared/geo.utils.js';
import { readAddressPoint, findZoneForPoint } from '../../shared/zoneServiceability.js';
import {
    getCoinSettings,
    getRedeemableForOrder,
    redeemCoins,
    reverseRedemption,
} from '../../coins/services/coin.service.js';
import {
    createOrder,
    deletePendingPaymentOrder,
    incrementCouponUsageForOrder,
    releasePaidOrder,
} from './order.service.js';
import { deductWalletBalance } from '../../user/services/userWallet.service.js';
import {
    createRazorpayOrder,
    fetchRazorpayOrder,
    fetchRazorpayPayment,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature,
} from '../helpers/razorpay.helper.js';
import { UserCart } from '../../user/models/userCart.model.js';
import { claimFirstOrder, releaseFirstOrderClaim, recordPaymentFingerprint } from './firstOrderGuard.service.js';

/**
 * A split checkout: one cart, one payment, one order per store.
 *
 * The checkout owns the money. Each store's order is priced on its own with
 * coupons off; the coupon and the coins are then applied once to the whole
 * cart and shared out between the stores. The orders never charge anyone:
 * cash on delivery goes live straight away, while wallet and online payments
 * hold the orders until the checkout is paid and then release all of them.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const toOid = (val, field = 'id') => {
    const s = String(val || '');
    if (!mongoose.Types.ObjectId.isValid(s)) throw new ValidationError(`Invalid ${field}`);
    return new mongoose.Types.ObjectId(s);
};

export function generateCheckoutId() {
    const timePart = Date.now().toString(36).toUpperCase();
    const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `CHK-${timePart}-${randPart}`;
}

/** Splits `amount` by `weights`, in paise, with the rounding left on the largest share. */
function shareByWeight(amount, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(amount > 0) || !(total > 0)) return weights.map(() => 0);
    const paise = Math.round(amount * 100);
    const shares = weights.map((w) => Math.floor((paise * w) / total));
    const largest = weights.indexOf(Math.max(...weights));
    shares[largest] += paise - shares.reduce((a, b) => a + b, 0);
    return shares.map((p) => p / 100);
}

/** Whole coins split by weight, the remainder going to the largest shares first. */
function coinsByWeight(coins, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(coins > 0) || !(total > 0)) return weights.map(() => 0);
    const exact = weights.map((w) => (coins * w) / total);
    const out = exact.map(Math.floor);
    let left = coins - out.reduce((a, b) => a + b, 0);
    const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
        if (left <= 0) break;
        out[i] += 1;
        left -= 1;
    }
    return out;
}

const normalizePaymentMethod = (value) => {
    const m = String(value || '').toLowerCase();
    if (m === 'card' || m === 'upi' || m === 'razorpay') return 'razorpay';
    if (m === 'wallet') return 'wallet';
    if (m === 'cash' || m === 'cod') return 'cash';
    throw new ValidationError('Choose how you want to pay');
};

/**
 * Prices a cart across its stores. What the customer sees here is what they
 * are charged: createSplitCheckout places each store's order with exactly
 * these shares.
 */
export async function calculateCheckoutPricing(userId, dto = {}) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    if (!items.length) throw new ValidationError('Checkout must contain at least one item');

    const fulfilmentMode = dto.fulfilmentMode === 'standard' ? 'standard' : 'quick';
    const deliveryAddress = normalizeDeliveryAddress(dto.deliveryAddress || dto.address || {});
    const deliveryMode = fulfilmentMode === 'quick' ? 'quick' : 'basic';
    // Quote what can be ordered: Quick is bounded by delivery zones (the same
    // rule order creation applies); Shop ships anywhere.
    if (fulfilmentMode === 'quick') {
        const point = readAddressPoint(deliveryAddress);
        if (point && !(await findZoneForPoint(point.lat, point.lng))) {
            throw new ValidationError("We don't deliver to this address yet");
        }
    }

    const itemsBySeller = new Map();
    for (const item of items) {
        const sellerId = String(item.sellerId || item.seller?._id || item.seller || '').trim();
        if (!mongoose.Types.ObjectId.isValid(sellerId)) {
            throw new ValidationError(`Item ${item.name || item.itemId || ''} has no valid store`);
        }
        if (!itemsBySeller.has(sellerId)) itemsBySeller.set(sellerId, []);
        itemsBySeller.get(sellerId).push(item);
    }

    // Each store on its own, coupons off.
    const stores = [];
    for (const [sellerId, sellerItems] of itemsBySeller) {
        const result = await calculateOrderPricing(
            userId,
            { sellerId, items: sellerItems, deliveryAddress, deliveryMode, fulfilmentMode },
            { skipAvailabilityCheck: true, skipCoupons: true },
        );
        stores.push({ sellerId, rawItems: sellerItems, items: result.items, base: result.pricing });
    }

    // One coupon for the cart, shared across the stores it covers.
    const codeRaw = dto.couponCode ? String(dto.couponCode).trim().toUpperCase() : '';
    const { discount: couponTotal, appliedCoupon, couponRefusal = null } = await resolveCoupon({
        userId,
        codeRaw,
        subtotalsBySeller: new Map(stores.map((s) => [s.sellerId, s.base.subtotal])),
        phones: [deliveryAddress?.phone],
        deviceId: dto.deviceId,
    });
    const covered = appliedCoupon?.sellerIds ? new Set(appliedCoupon.sellerIds) : null;
    const couponShares = shareByWeight(
        couponTotal,
        stores.map((s) => (!covered || covered.has(s.sellerId) ? s.base.subtotal : 0)),
    );

    const { gstRate } = await loadActiveFeeSettings();
    const fallbackRate = Number(gstRate || 0);
    const couponCode = appliedCoupon?.code || null;
    const afterCoupon = stores.map((s, i) =>
        applyCheckoutShare(s.base, s.items, { couponShare: couponShares[i], fallbackRate, couponCode }));

    // Coins, capped against the cart after the coupon, shared the same way.
    let coinsUsed = 0;
    let coinsDiscount = 0;
    const requested = Math.max(0, Math.floor(Number(dto.coins) || 0));
    if (requested > 0 && userId) {
        const payable = afterCoupon.reduce((sum, p) => sum + p.total, 0);
        const { coins: maxCoins } = await getRedeemableForOrder(userId, payable);
        const { coinValue } = await getCoinSettings();
        coinsUsed = Math.min(requested, maxCoins);
        coinsDiscount = round2(coinsUsed * coinValue);
    }
    const coinShares = coinsByWeight(coinsUsed, afterCoupon.map((p) => p.total));
    const { coinValue } = coinsUsed > 0 ? await getCoinSettings() : { coinValue: 1 };

    const childPricings = stores.map((s, i) => {
        const coins = coinShares[i];
        const pricing = applyCheckoutShare(s.base, s.items, {
            couponShare: couponShares[i],
            coinsDiscount: round2(coins * coinValue),
            fallbackRate,
            couponCode,
        });
        return {
            sellerId: s.sellerId,
            items: s.rawItems,
            resolvedItems: s.items,
            pricing,
            couponShare: couponShares[i],
            coinsUsed: coins,
            coinsDiscount: pricing.coinsDiscount,
        };
    });

    const sum = (key) => round2(childPricings.reduce((acc, c) => acc + (Number(c.pricing[key]) || 0), 0));
    return {
        fulfilmentMode,
        subtotal: sum('subtotal'),
        tax: sum('tax'),
        packagingFee: sum('packagingFee'),
        deliveryFee: round2(sum('deliveryFee') + sum('deliveryFeeGst')),
        platformFee: sum('platformFee'),
        discount: sum('discount'),
        couponCode: couponTotal > 0 ? couponCode : null,
        appliedCoupon: couponTotal > 0 ? appliedCoupon : null,
        couponRefusal,
        coinsUsed,
        coinsDiscount,
        grandTotal: sum('total'),
        childPricings,
    };
}

/** Removes a checkout that could not be completed: its orders, stock and coins. */
async function unwindCheckout(checkout, orders) {
    for (const order of orders) {
        try {
            if (order.orderStatus === 'pending_payment') {
                await deletePendingPaymentOrder(order);
            } else {
                await restoreOrderStock(order);
                await Order.deleteOne({ _id: order._id });
            }
        } catch (err) {
            logger.error(`[CRITICAL] Could not unwind order ${order._id} of checkout ${checkout.checkoutId}: ${err?.message || err}`);
        }
    }
    await releaseFirstOrderClaim({ checkoutId: checkout._id }).catch(() => {});
    try {
        await reverseRedemption(checkout._id, { note: 'Checkout not completed' });
    } catch (err) {
        logger.error(`[CRITICAL] Could not return coins of checkout ${checkout.checkoutId}: ${err?.message || err}`);
    }
    await Checkout.deleteOne({ _id: checkout._id });
}

/**
 * Places a checkout: one order per store, and one payment for all of them.
 *
 * Returns `razorpay` for an online payment; the app opens it and then calls
 * verifyCheckoutPayment. Cash and wallet checkouts are complete on return.
 */
export async function createSplitCheckout(userId, dto = {}) {
    const userOid = toOid(userId, 'user id');
    const paymentMethod = normalizePaymentMethod(dto.paymentMethod);
    const deliveryAddress = normalizeDeliveryAddress(dto.deliveryAddress || dto.address || {});
    if (!readAddressPoint(deliveryAddress)) {
        throw new ValidationError('This address has no location saved. Please re-select it on the map.');
    }
    if (paymentMethod === 'razorpay' && !isRazorpayConfigured()) {
        throw new ValidationError('Online payment is not available right now');
    }

    const quote = await calculateCheckoutPricing(userId, { ...dto, deliveryAddress });
    const checkoutId = generateCheckoutId();
    const checkout = await Checkout.create({
        checkoutId,
        userId: userOid,
        fulfilmentMode: quote.fulfilmentMode,
        sellerIds: quote.childPricings.map((c) => toOid(c.sellerId, 'store id')),
        customerAddress: deliveryAddress,
        pricing: {
            subtotal: quote.subtotal,
            tax: quote.tax,
            packagingFee: quote.packagingFee,
            deliveryFee: quote.deliveryFee,
            platformFee: quote.platformFee,
            discount: quote.discount,
            coinsUsed: quote.coinsUsed,
            coinsDiscount: quote.coinsDiscount,
            couponCode: quote.couponCode,
            grandTotal: quote.grandTotal,
            currency: 'INR',
        },
        payment: { method: paymentMethod, status: paymentMethod === 'cash' ? 'cod_pending' : 'pending' },
        status: 'pending',
        appliedCoupon: quote.appliedCoupon,
    });

    // A first-order offer is taken once per person (account, phone, device,
    // payment): the claim decides a race between two checkouts atomically.
    if (quote.appliedCoupon?.firstOrder) {
        try {
            await claimFirstOrder({ userId, deviceId: dto.deviceId, checkoutId: checkout._id, offerCode: quote.appliedCoupon.code });
        } catch (err) {
            await Checkout.deleteOne({ _id: checkout._id });
            throw err;
        }
    }

    // Coins first: if they are no longer there, nothing else has happened yet.
    if (quote.coinsUsed > 0) {
        try {
            await redeemCoins({ userId, orderId: checkout._id, coins: quote.coinsUsed });
        } catch (err) {
            await releaseFirstOrderClaim({ checkoutId: checkout._id }).catch(() => {});
            await Checkout.deleteOne({ _id: checkout._id });
            throw err;
        }
    }

    const orders = [];
    try {
        for (const child of quote.childPricings) {
            const { order } = await createOrder(
                userId,
                {
                    sellerId: child.sellerId,
                    items: child.items,
                    address: deliveryAddress,
                    paymentMethod,
                    deliveryMode: quote.fulfilmentMode === 'quick' ? 'quick' : 'basic',
                    scheduledAt: dto.scheduledAt,
                    note: dto.note,
                },
                {
                    checkout: {
                        checkoutId: checkout._id,
                        orderGroupId: checkoutId,
                        fulfilmentMode: quote.fulfilmentMode,
                        couponShare: child.couponShare,
                        couponCode: quote.couponCode,
                        coinsUsed: child.coinsUsed,
                        coinsDiscount: child.coinsDiscount,
                    },
                },
            );
            orders.push(await Order.findById(order._id || order.id));
        }
    } catch (err) {
        await unwindCheckout(checkout, orders.filter(Boolean));
        throw err;
    }

    // What the orders actually came to is what gets charged.
    const grandTotal = round2(orders.reduce((sum, o) => sum + (Number(o.pricing?.total) || 0), 0));
    checkout.pricing.grandTotal = grandTotal;
    checkout.childOrderIds = orders.map((o) => o._id);
    checkout.childOrderCodes = orders.map((o) => o.order_id || o.orderId || String(o._id));

    let razorpay = null;
    try {
        if (paymentMethod === 'cash') {
            checkout.status = 'confirmed';
            await checkout.save();
            await incrementCouponUsageForOrder(checkout, userId);
        } else if (paymentMethod === 'wallet') {
            await checkout.save();
            await deductWalletBalance(userId, grandTotal, `Payment for checkout ${checkoutId}`, { checkoutId });
            await finalizeCheckoutPaid(checkout._id, { byRole: 'USER', byId: userId });
        } else {
            const rzOrder = await createRazorpayOrder(Math.round(grandTotal * 100), 'INR', checkoutId, {
                purpose: 'checkout',
                checkoutId,
            });
            checkout.payment.gatewayOrderId = String(rzOrder.id);
            await checkout.save();
            await Order.updateMany(
                { checkoutId: checkout._id },
                { $set: { 'payment.razorpay.orderId': String(rzOrder.id) } },
            );
            razorpay = {
                key: getRazorpayKeyId(),
                orderId: String(rzOrder.id),
                amount: Number(rzOrder.amount) || Math.round(grandTotal * 100),
                currency: rzOrder.currency || 'INR',
            };
        }
    } catch (err) {
        await unwindCheckout(checkout, await Order.find({ checkoutId: checkout._id }));
        throw err;
    }

    // Only the storefront that was checked out; the other mode's cart stays.
    await UserCart.deleteOne({
        userId: userOid,
        mode: quote.fulfilmentMode === 'quick' ? 'quick' : { $in: ['shop', null] },
    });
    const fresh = await Checkout.findById(checkout._id).lean();
    return {
        checkout: fresh,
        childOrders: await Order.find({ checkoutId: checkout._id }).lean(),
        pricing: { ...quote, grandTotal },
        razorpay,
    };
}

/**
 * Marks a checkout paid and releases every order in it, once, however many of
 * the app's verify call and the gateway's webhook arrive.
 */
export async function finalizeCheckoutPaid(checkoutOid, { byRole = 'SYSTEM', byId = null, razorpayPaymentId = '', razorpaySignature = '' } = {}) {
    const checkout = await Checkout.findOneAndUpdate(
        { _id: checkoutOid, 'payment.status': { $nin: ['paid', 'refunded'] }, status: { $ne: 'cancelled' } },
        {
            $set: {
                'payment.status': 'paid',
                'payment.paidAt': new Date(),
                'payment.gatewayPaymentId': razorpayPaymentId,
                status: 'confirmed',
            },
        },
        { new: true },
    );
    if (!checkout) return { released: 0 };

    const held = await Order.find({ checkoutId: checkout._id, orderStatus: 'pending_payment' });
    if (!held.length) {
        logger.error(`[CRITICAL] Checkout ${checkout.checkoutId} was paid but has no orders waiting; refund needed`);
    }
    for (const order of held) {
        try {
            await releasePaidOrder(order, {
                byRole,
                byId,
                razorpayPaymentId,
                razorpaySignature,
                note: 'Checkout paid',
                countCoupon: false,
            });
        } catch (err) {
            logger.error(`[CRITICAL] Releasing order ${order._id} of paid checkout ${checkout.checkoutId} failed: ${err?.message || err}`);
        }
    }
    await incrementCouponUsageForOrder(checkout, checkout.userId);
    return { released: held.length };
}

/**
 * The app's confirmation of an online payment. The signature only proves the
 * payment belongs to the Razorpay order, so the amount and status are checked
 * with Razorpay before anything is released.
 */
export async function verifyCheckoutPayment(userId, dto = {}) {
    const checkout = await Checkout.findOne({ checkoutId: String(dto.checkoutId || ''), userId: toOid(userId, 'user id') });
    if (!checkout) throw new NotFoundError('Checkout not found');
    if (checkout.payment.status === 'paid') return { checkout: checkout.toObject(), alreadyPaid: true };

    const rzOrderId = String(dto.razorpayOrderId || '');
    const rzPaymentId = String(dto.razorpayPaymentId || '');
    if (!rzOrderId || rzOrderId !== checkout.payment.gatewayOrderId) {
        throw new ValidationError('Payment verification failed');
    }
    if (!verifyPaymentSignature(rzOrderId, rzPaymentId, String(dto.razorpaySignature || ''))) {
        throw new ValidationError('Payment verification failed');
    }

    let payment;
    try {
        payment = await fetchRazorpayPayment(rzPaymentId);
    } catch (err) {
        logger.error(`Razorpay payment fetch failed for checkout ${checkout.checkoutId}: ${err?.message || err}`);
        throw new ValidationError('Payment verification failed. Please retry in a moment.');
    }
    const expectedPaise = Math.round((Number(checkout.pricing.grandTotal) || 0) * 100);
    const status = String(payment?.status || '').toLowerCase();
    if (
        String(payment?.order_id || '') !== rzOrderId
        || !['captured', 'authorized'].includes(status)
        || Number(payment?.amount) !== expectedPaise
    ) {
        logger.error(`Checkout ${checkout.checkoutId} payment rejected: paid ${payment?.amount} paise (${status}), expected ${expectedPaise}`);
        await Checkout.updateOne({ _id: checkout._id, 'payment.status': { $ne: 'paid' } }, { $set: { 'payment.status': 'failed' } });
        throw new ValidationError('Payment verification failed');
    }

    await recordPaymentFingerprint({ checkoutId: checkout._id, payment }).catch((err) =>
        logger.warn(`First-order payment fingerprint for ${checkout.checkoutId} failed: ${err?.message || err}`));
    await finalizeCheckoutPaid(checkout._id, {
        byRole: 'USER',
        byId: userId,
        razorpayPaymentId: rzPaymentId,
        razorpaySignature: String(dto.razorpaySignature || ''),
    });
    return { checkout: (await Checkout.findById(checkout._id).lean()) };
}

/**
 * The gateway's word that an online payment went through, for when the app
 * never came back to verify. Returns false if the Razorpay order is not a checkout's.
 */
export async function handleCheckoutPaymentCaptured({ rzOrderId, rzPaymentId, amountPaise, payment }) {
    const checkout = await Checkout.findOne({ 'payment.gatewayOrderId': String(rzOrderId) });
    if (!checkout) return false;
    const expectedPaise = Math.round((Number(checkout.pricing.grandTotal) || 0) * 100);
    if (Number(amountPaise) !== expectedPaise) {
        logger.error(`Webhook: checkout ${checkout.checkoutId} captured ${amountPaise} paise, expected ${expectedPaise}; not released`);
        return true;
    }
    await finalizeCheckoutPaid(checkout._id, { byRole: 'SYSTEM', razorpayPaymentId: String(rzPaymentId || '') });
    // Same first-order card/UPI record as the verify path; never fails a paid checkout.
    if (payment) {
        await recordPaymentFingerprint({ checkoutId: checkout._id, payment })
            .catch((err) => logger.warn(`first-order fingerprint for ${checkout.checkoutId}: ${err.message}`));
    }
    return true;
}

/** The customer closed the payment sheet: give back stock and coins now. */
export async function abandonCheckout(userId, checkoutId) {
    const checkout = await Checkout.findOne({ checkoutId: String(checkoutId || ''), userId: toOid(userId, 'user id') });
    if (!checkout) throw new NotFoundError('Checkout not found');
    if (checkout.payment.status === 'paid') throw new ValidationError('This checkout is already paid');

    for (const order of await Order.find({ checkoutId: checkout._id, orderStatus: 'pending_payment' })) {
        await deletePendingPaymentOrder(order);
    }
    await Checkout.updateOne({ _id: checkout._id }, { $set: { status: 'cancelled', 'payment.status': 'failed' } });
    await reverseRedemption(checkout._id, { note: 'Payment not completed' });
    await releaseFirstOrderClaim({ checkoutId: checkout._id });
    return { abandoned: true };
}

/** How long an online checkout holds its stock and coins while unpaid (matches the stale-order sweep). */
export const CHECKOUT_PAYMENT_HOLD_MS = 30 * 60 * 1000;

const conflict = (message, data) => Object.assign(new Error(message), { name: 'ConflictError', statusCode: 409, data });

/**
 * Lets the owner pay again for an online checkout whose payment failed or was
 * closed, while its orders are still held. The same Razorpay order is handed
 * back when it is still open for the same amount, so repeated calls are safe;
 * otherwise a new one is made for the same grand total. Verify is unchanged.
 */
export async function retryCheckoutPayment(userId, checkoutId, now = new Date()) {
    const checkout = await Checkout.findOne({ checkoutId: String(checkoutId || ''), userId: toOid(userId, 'user id') });
    if (!checkout) throw new NotFoundError('Checkout not found');
    if (checkout.payment.method !== 'razorpay') throw new ValidationError('Only online payments can be retried');
    if (checkout.payment.status === 'paid') throw conflict('This checkout is already paid', { reason: 'already_paid' });

    const holdEndsAt = new Date(new Date(checkout.createdAt).getTime() + CHECKOUT_PAYMENT_HOLD_MS);
    const held = await Order.countDocuments({ checkoutId: checkout._id, orderStatus: 'pending_payment' });
    if (checkout.status === 'cancelled' || now >= holdEndsAt || held === 0) {
        throw conflict('The time to pay for this order has run out and the items were released. Please place the order again.', {
            reason: 'hold_expired', holdEndsAt,
        });
    }
    if (!isRazorpayConfigured()) throw new ValidationError('Online payment is not available right now');

    const amountPaise = Math.round((Number(checkout.pricing.grandTotal) || 0) * 100);
    let rzOrder = null;
    if (checkout.payment.gatewayOrderId) {
        try {
            const existing = await fetchRazorpayOrder(checkout.payment.gatewayOrderId);
            if (existing && Number(existing.amount) === amountPaise) {
                if (String(existing.status) === 'paid') {
                    throw conflict('We have received this payment and are confirming it. Please refresh in a moment.', { reason: 'payment_received' });
                }
                rzOrder = existing;
            }
        } catch (err) {
            if (err?.statusCode === 409) throw err;
            logger.warn(`Razorpay order fetch failed for checkout ${checkout.checkoutId}: ${err?.message || err}`);
        }
    }
    if (!rzOrder) {
        rzOrder = await createRazorpayOrder(amountPaise, 'INR', checkout.checkoutId, { purpose: 'checkout', checkoutId: checkout.checkoutId });
        await Order.updateMany({ checkoutId: checkout._id }, { $set: { 'payment.razorpay.orderId': String(rzOrder.id) } });
    }
    await Checkout.updateOne(
        { _id: checkout._id, 'payment.status': { $ne: 'paid' } },
        { $set: { 'payment.gatewayOrderId': String(rzOrder.id), 'payment.status': 'pending' } },
    );

    return {
        checkoutId: checkout.checkoutId,
        holdEndsAt,
        grandTotal: checkout.pricing.grandTotal,
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(rzOrder.id),
            amount: amountPaise,
            currency: rzOrder.currency || 'INR',
        },
    };
}

/** A checkout with its orders, for its owner. */
export async function getCheckoutById(checkoutId, userId) {
    const query = { checkoutId: String(checkoutId) };
    if (userId) query.userId = toOid(userId, 'user id');
    const checkout = await Checkout.findOne(query).populate('childOrderIds').lean();
    if (!checkout) throw new NotFoundError('Checkout not found');
    return checkout;
}
