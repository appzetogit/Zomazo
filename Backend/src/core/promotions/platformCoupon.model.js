import mongoose from 'mongoose';
import { couponCodePlugin } from './couponCodeRegistry.js';

/**
 * A coupon made once in Master and honoured by every service it names.
 *
 * Each service keeps its own coupons for its own offers (a restaurant's, a
 * seller's); these are the platform's, so the platform funds the discount and a
 * customer's uses are counted against their ONE account (users._id) whichever
 * service they redeem in. See platformCoupon.service.js.
 */
export const PLATFORM_COUPON_SERVICES = Object.freeze([
    'food', 'quickCommerce', 'ecommerce', 'taxi', 'serviceProvider',
]);

const platformCouponSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, trim: true, uppercase: true, unique: true, match: /^[A-Z0-9_-]{3,20}$/ },
        title: { type: String, trim: true, default: '' },
        description: { type: String, trim: true, default: '' },
        services: {
            type: [{ type: String, enum: PLATFORM_COUPON_SERVICES }],
            validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Pick at least one service' },
        },
        discountType: { type: String, enum: ['percentage', 'flat'], required: true },
        discountValue: { type: Number, required: true, min: 0 },
        // Percentage coupons only; 0 is no cap.
        maxDiscount: { type: Number, default: 0, min: 0 },
        minOrderValue: { type: Number, default: 0, min: 0 },
        // 'first_order': the customer's first order in the service they use it in.
        audience: { type: String, enum: ['all', 'first_order'], default: 'all' },
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null },
        status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
        // 0 is unlimited, for both.
        usageLimit: { type: Number, default: 0, min: 0 },
        perUserLimit: { type: Number, default: 1, min: 0 },
        usedCount: { type: Number, default: 0, min: 0 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'platform_coupons', timestamps: true },
);

// A code any service's coupon already holds is refused, and vice versa.
platformCouponSchema.plugin(couponCodePlugin, { field: 'code', collection: 'platform_coupons' });

export const PlatformCoupon = mongoose.models.PlatformCoupon
    || mongoose.model('PlatformCoupon', platformCouponSchema);

/** One customer's uses of one platform coupon, across every service. */
const platformCouponUseSchema = new mongoose.Schema(
    {
        couponId: { type: mongoose.Schema.Types.ObjectId, required: true },
        platformUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
        count: { type: Number, default: 0, min: 0 },
        lastUsedAt: { type: Date, default: null },
        lastService: { type: String, default: '' },
    },
    { collection: 'platform_coupon_uses', timestamps: true },
);
// The claim's upsert at the limit hits this and is refused (see claimPlatformCoupon).
platformCouponUseSchema.index({ couponId: 1, platformUserId: 1 }, { unique: true });

export const PlatformCouponUse = mongoose.models.PlatformCouponUse
    || mongoose.model('PlatformCouponUse', platformCouponUseSchema);
