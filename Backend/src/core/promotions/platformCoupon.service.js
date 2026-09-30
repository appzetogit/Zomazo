/**
 * Quote, claim and release a platform coupon (platformCoupon.model.js).
 *
 * Each service calls these where it already handles its own coupons: quote
 * while pricing (a code its own offers do not know), claim when the order is
 * placed, release when an order that claimed it is given up. The service keeps
 * its own bill, payout and ledger; a platform coupon is platform-funded, so it
 * is booked the way that service books an admin coupon.
 *
 * Limits are counted per customer ACCOUNT (users._id), so "once per customer"
 * holds across every service the coupon names -- a customer who used it on
 * Food cannot use it again on the Shop. Master > Promotions' ceiling applies on
 * top, as it does to each service's own coupons.
 */
import mongoose from 'mongoose';
import { PlatformCoupon, PlatformCouponUse } from './platformCoupon.model.js';
import { resolvePromoCeiling, tighten } from '../finance/promoLimits.service.js';

const normalize = (code) => String(code || '').trim().toUpperCase();
const toOid = (id) => {
    const raw = String(id?._id ?? id ?? '');
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

/** The platform coupon with this code, whatever its state, or null. */
export async function findPlatformCoupon(code) {
    const wanted = normalize(code);
    if (!wanted) return null;
    return PlatformCoupon.findOne({ code: wanted }).lean();
}

/** The coupon's limits with the service's Master ceiling applied (0 = unlimited). */
// The services whose own coupons the Master ceiling governs; the Shop and
// Services check their coupons without it (couponList.service.js `noCeiling`).
const CEILING_SERVICES = new Set(['food', 'quickCommerce', 'taxi']);

async function effectiveLimits(coupon, service) {
    const ceiling = CEILING_SERVICES.has(service)
        ? await resolvePromoCeiling({ vertical: service })
        : { perUser: null, total: null };
    return {
        total: tighten(coupon.usageLimit || null, ceiling.total) || 0,
        perUser: tighten(coupon.perUserLimit || null, ceiling.perUser) || 0,
    };
}

export function platformCouponDiscount(coupon, subtotal) {
    const base = Math.max(0, Number(subtotal) || 0);
    if (!coupon || base <= 0) return 0;
    if (coupon.discountType === 'percentage') {
        const raw = base * ((Number(coupon.discountValue) || 0) / 100);
        const capped = Number(coupon.maxDiscount) > 0 ? Math.min(raw, Number(coupon.maxDiscount)) : raw;
        return Math.max(0, Math.min(base, Math.floor(capped)));
    }
    return Math.max(0, Math.min(base, Math.floor(Number(coupon.discountValue) || 0)));
}

/**
 * What this code takes off an order, or why it does not.
 *
 * Returns { coupon, discount, reason }: `coupon` is null when no platform
 * coupon has this code (the caller then treats the code as its own, as
 * before); `discount` is 0 with a `reason` when it exists but does not apply.
 * `isFirstOrder` is the service's own answer for this customer; a first-order
 * coupon is refused when it is not true.
 */
export async function quotePlatformCoupon(code, { service, platformUserId, subtotal, isFirstOrder = null, now = new Date() } = {}) {
    const coupon = await findPlatformCoupon(code);
    if (!coupon) return { coupon: null, discount: 0, reason: 'not_found' };
    const refuse = (reason) => ({ coupon, discount: 0, reason });

    if (coupon.status !== 'active') return refuse('This coupon is not active.');
    if (!(coupon.services || []).includes(service)) return refuse('This coupon cannot be used here.');
    if (coupon.startDate && now < new Date(coupon.startDate)) return refuse('This coupon has not started yet.');
    if (coupon.endDate && now >= new Date(coupon.endDate)) return refuse('This coupon has expired.');
    if ((Number(subtotal) || 0) < (Number(coupon.minOrderValue) || 0)) {
        return refuse(`Add items worth Rs ${coupon.minOrderValue} to use this coupon.`);
    }
    if (coupon.audience === 'first_order' && isFirstOrder !== true) {
        return refuse('This coupon is only for your first order.');
    }

    const limits = await effectiveLimits(coupon, service);
    if (limits.total > 0 && Number(coupon.usedCount || 0) >= limits.total) return refuse('This coupon has been fully used.');
    const userOid = toOid(platformUserId);
    if (limits.perUser > 0) {
        if (!userOid) return refuse('Sign in to use this coupon.');
        const use = await PlatformCouponUse.findOne({ couponId: coupon._id, platformUserId: userOid }).lean();
        if (Number(use?.count || 0) >= limits.perUser) return refuse('You have already used this coupon.');
    }

    const discount = platformCouponDiscount(coupon, subtotal);
    if (discount <= 0) return refuse('This coupon takes nothing off this order.');
    return { coupon, discount, reason: null };
}

/**
 * Take one use, atomically: the customer's own count (a unique index turns a
 * claim at the limit into the refusal) and the coupon's total. Both or neither.
 *
 * `enforce: false` counts the use whatever the limits say, and reports
 * `overLimit` -- for an order already paid at the discounted price, which the
 * platform cannot now refuse (the services count their own coupons the same way).
 * Returns { taken, exhausted, perUser, overLimit }.
 */
export async function claimPlatformCoupon(code, { service, platformUserId, enforce = true } = {}) {
    const coupon = await findPlatformCoupon(code);
    if (!coupon) return { taken: false, exhausted: false, perUser: false, overLimit: false };
    const limits = await effectiveLimits(coupon, service);
    const userOid = toOid(platformUserId);
    const stamp = { $set: { lastUsedAt: new Date(), lastService: String(service || '') } };

    if (!enforce) {
        let overLimit = false;
        if (userOid) {
            const use = await PlatformCouponUse.findOneAndUpdate(
                { couponId: coupon._id, platformUserId: userOid },
                { $inc: { count: 1 }, ...stamp },
                { upsert: true, new: true },
            ).lean();
            if (limits.perUser > 0 && use.count > limits.perUser) overLimit = true;
        }
        const after = await PlatformCoupon.findOneAndUpdate({ _id: coupon._id }, { $inc: { usedCount: 1 } }, { new: true }).lean();
        if (limits.total > 0 && after.usedCount > limits.total) overLimit = true;
        return { taken: true, exhausted: false, perUser: false, overLimit };
    }

    let userClaimed = false;
    if (userOid) {
        try {
            const r = await PlatformCouponUse.updateOne(
                limits.perUser > 0
                    ? { couponId: coupon._id, platformUserId: userOid, count: { $lt: limits.perUser } }
                    : { couponId: coupon._id, platformUserId: userOid },
                { $inc: { count: 1 }, ...stamp },
                { upsert: true },
            );
            userClaimed = r.matchedCount === 1 || r.upsertedCount === 1;
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
        if (!userClaimed) return { taken: false, exhausted: true, perUser: true, overLimit: false };
    } else if (limits.perUser > 0) {
        return { taken: false, exhausted: true, perUser: true, overLimit: false };
    }

    const total = await PlatformCoupon.updateOne(
        limits.total > 0 ? { _id: coupon._id, usedCount: { $lt: limits.total } } : { _id: coupon._id },
        { $inc: { usedCount: 1 } },
    );
    if (total.matchedCount === 0) {
        if (userClaimed) {
            await PlatformCouponUse.updateOne(
                { couponId: coupon._id, platformUserId: userOid, count: { $gt: 0 } },
                { $inc: { count: -1 } },
            );
        }
        return { taken: false, exhausted: true, perUser: false, overLimit: false };
    }
    return { taken: true, exhausted: false, perUser: false, overLimit: false };
}

/** Give one use back (an order that claimed it was never placed or was given up). */
export async function releasePlatformCoupon(code, { platformUserId } = {}) {
    const coupon = await findPlatformCoupon(code);
    if (!coupon) return;
    await PlatformCoupon.updateOne({ _id: coupon._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    const userOid = toOid(platformUserId);
    if (userOid) {
        await PlatformCouponUse.updateOne(
            { couponId: coupon._id, platformUserId: userOid, count: { $gt: 0 } },
            { $inc: { count: -1 } },
        );
    }
}
