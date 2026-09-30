import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { Offer } from '../../admin/models/offer.model.js';
import { OfferUsage } from '../../admin/models/offerUsage.model.js';
import { Order } from '../models/order.model.js';
import { Checkout } from '../models/checkout.model.js';
import { logger } from '../../../../utils/logger.js';
import { claimPlatformCoupon, findPlatformCoupon, platformAccountOf, releasePlatformCoupon } from '../../../../../../core/promotions/platformCoupon.service.js';

/*
 * A coupon's per-customer limit, claimed when the order is placed.
 *
 * It was only checked by reading the usage count while pricing, and counted
 * after placement (cash) or payment (online), so several orders placed at the
 * same moment each saw "not used yet" and all kept a one-per-customer coupon.
 * Food claims atomically at placement since 22 Sep; this is the Shop's copy.
 *
 * The claim is one conditional upsert on (offer, customer): below the limit it
 * counts the use, at the limit the unique index turns the upsert into a
 * duplicate-key error, which is the refusal. The order or checkout records the
 * claim in `couponClaim`, and incrementCouponUsageForOrder then does not count
 * the customer a second time. A claim is given back, once, when the unpaid
 * order or checkout holding it is given up.
 */

const toOid = (id) => (mongoose.Types.ObjectId.isValid(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);

async function tryClaim(offer, userOid) {
    try {
        const r = await OfferUsage.updateOne(
            { offerId: offer._id, userId: userOid, count: { $lt: Number(offer.perUserLimit) } },
            { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
            { upsert: true },
        );
        return r.matchedCount === 1 || r.upsertedCount === 1;
    } catch (err) {
        if (err?.code === 11000) return false;
        throw err;
    }
}

/**
 * The customer's own earlier unpaid order or checkout holding this coupon gives
 * way to the new one: closing the payment sheet and trying again must not find
 * the coupon "already used" by an order that will never be paid. If that order
 * is paid late after all, the webhook refunds it (it is cancelled by then).
 */
async function supersedeUnpaidHolder(holding, userOid) {
    const order = await Order.findOne({
        userId: userOid,
        orderStatus: 'pending_payment',
        checkoutId: null,
        ...holding,
        'couponClaim.releasedAt': null,
    }).lean();
    if (order) {
        const { deletePendingPaymentOrder } = await import('./order.service.js');
        if (await deletePendingPaymentOrder(order)) return true;
    }
    const checkout = await Checkout.findOne({
        userId: userOid,
        status: 'pending',
        'payment.status': { $nin: ['paid', 'refunded', 'cod_pending'] },
        ...holding,
        'couponClaim.releasedAt': null,
    }).lean();
    if (checkout) {
        const { abandonCheckout } = await import('./orderSplit.service.js');
        await abandonCheckout(userOid, checkout.checkoutId).catch(() => null);
        return true;
    }
    return false;
}

/**
 * Claims one use of `couponCode` for the customer. Returns the claim to store
 * on the order or checkout (`{ offerId }`), or null when the coupon has no
 * per-customer limit. Throws when the customer has used it up.
 */
export async function claimCouponForCustomer({ couponCode, userId }) {
    const code = String(couponCode || '').trim().toUpperCase();
    const userOid = toOid(userId);
    if (!code || !userOid) return null;
    const offer = await Offer.findOne({ couponCode: code }).select('_id perUserLimit').lean();
    if (!offer) {
        // A platform coupon (made in Master for several services): claimed
        // whole -- the customer's use and the coupon's total -- against their
        // platform account, so a use on another service counts here too.
        if (!(await findPlatformCoupon(code))) return null;
        const platformUserId = await platformAccountOf(userOid);
        const take = () => claimPlatformCoupon(code, { service: 'ecommerce', platformUserId });
        let pc = await take();
        if (pc.exhausted && pc.perUser && await supersedeUnpaidHolder({ 'couponClaim.platformCode': code }, userOid)) {
            pc = await take();
        }
        if (pc.taken) return { platformCode: code };
        throw new ValidationError(pc.perUser
            ? `You have already used the coupon ${code}.`
            : `The coupon ${code} has just been fully used.`);
    }
    if (!(Number(offer.perUserLimit) > 0)) return null;

    if (await tryClaim(offer, userOid)) return { offerId: offer._id };
    if (await supersedeUnpaidHolder({ 'couponClaim.offerId': offer._id }, userOid) && await tryClaim(offer, userOid)) {
        return { offerId: offer._id };
    }
    throw new ValidationError(`You have already used the coupon ${code}.`);
}

/** Gives back a claim that was never attached to an order (placement failed). */
export async function returnCouponClaim(claim, userId) {
    const userOid = toOid(userId);
    if (claim?.platformCode && userOid) {
        await releasePlatformCoupon(claim.platformCode, { platformUserId: await platformAccountOf(userOid) })
            .catch((err) => logger.error(`[coupon] could not return a platform claim for ${userOid}: ${err?.message || err}`));
        return;
    }
    if (!claim?.offerId || !userOid) return;
    await OfferUsage.updateOne(
        { offerId: claim.offerId, userId: userOid, count: { $gt: 0 } },
        { $inc: { count: -1 } },
    ).catch((err) => logger.error(`[coupon] could not return a claim for ${userOid}: ${err?.message || err}`));
}

/**
 * Gives back the claim held by an order or checkout, once: the flip of
 * `couponClaim.releasedAt` is the guard, so two sweeps or an abandon racing a
 * sweep cannot both decrement.
 */
export async function releaseCouponClaim(Model, id) {
    const doc = await Model.findOneAndUpdate(
        {
            _id: id,
            $or: [{ 'couponClaim.offerId': { $ne: null } }, { 'couponClaim.platformCode': { $nin: [null, ''] } }],
            'couponClaim.releasedAt': null,
        },
        { $set: { 'couponClaim.releasedAt': new Date() } },
        { new: false, projection: { couponClaim: 1, userId: 1 } },
    ).lean();
    if (!doc?.couponClaim?.offerId && !doc?.couponClaim?.platformCode) return false;
    await returnCouponClaim(doc.couponClaim, doc.userId);
    return true;
}
