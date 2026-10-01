import mongoose from 'mongoose';
import { PLATFORM_COUPON_SERVICES } from './platformCoupon.model.js';

/**
 * Cashback offers and wallet bonuses, made once in admin and paid into the
 * customer's ONE wallet (core/wallet/customerWallet.model.js) whichever service
 * the order or top-up came from.
 *
 * Each service still has its own single "cashback settings" document from
 * before; those are only consulted when no offer here applies to the order
 * (core/promotions/cashback.service.js), so nothing configured earlier stops
 * paying the day this ships.
 */

export const REWARD_SERVICES = PLATFORM_COUPON_SERVICES;

const cashbackOfferSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 80 },
        services: {
            type: [{ type: String, enum: REWARD_SERVICES }],
            validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Pick at least one service' },
        },
        // 'percentage' of the order's item subtotal (a ride's fare), or 'flat' rupees.
        cashbackType: { type: String, enum: ['percentage', 'flat'], required: true },
        cashbackValue: { type: Number, required: true, min: 0 },
        // Percentage offers only; 0 is uncapped.
        maxCashback: { type: Number, default: 0, min: 0 },
        minOrderValue: { type: Number, default: 0, min: 0 },
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null },
        // Awards per customer account across every service; 0 is unlimited.
        perUserLimit: { type: Number, default: 0, min: 0 },
        status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
        usedCount: { type: Number, default: 0, min: 0 },
        totalCredited: { type: Number, default: 0, min: 0 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'platform_cashback_offers', timestamps: true },
);

export const CashbackOffer = mongoose.models.CashbackOffer
    || mongoose.model('CashbackOffer', cashbackOfferSchema);

/*
 * One customer's awards from one offer. The per-customer limit is claimed here
 * with a conditional upsert before the wallet is credited, so two deliveries
 * finishing together cannot both slip under the limit.
 */
const cashbackOfferUseSchema = new mongoose.Schema(
    {
        offerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        platformUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
        count: { type: Number, default: 0, min: 0 },
    },
    { collection: 'platform_cashback_offer_uses', timestamps: true },
);
cashbackOfferUseSchema.index({ offerId: 1, platformUserId: 1 }, { unique: true });

export const CashbackOfferUse = mongoose.models.CashbackOfferUse
    || mongoose.model('CashbackOfferUse', cashbackOfferUseSchema);

/** "Add Rs X or more to the wallet, get Y extra." */
const walletBonusSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, trim: true, default: '', maxlength: 300 },
        bonusType: { type: String, enum: ['percentage', 'flat'], required: true },
        bonusValue: { type: Number, required: true, min: 0 },
        minTopup: { type: Number, default: 0, min: 0 },
        // Percentage bonuses only; 0 is uncapped.
        maxBonus: { type: Number, default: 0, min: 0 },
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null },
        status: { type: String, enum: ['active', 'paused'], default: 'active', index: true },
        usedCount: { type: Number, default: 0, min: 0 },
        totalCredited: { type: Number, default: 0, min: 0 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'platform_wallet_bonuses', timestamps: true },
);

export const WalletBonus = mongoose.models.WalletBonus
    || mongoose.model('WalletBonus', walletBonusSchema);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * What a percentage-or-flat rule pays on `base`. Whole rupees, rounded down, the
 * way the services' own cashback always has been -- never in the customer's
 * favour by a fraction we did not intend to give.
 */
export function rewardAmount({ type, value, max, min }, base) {
    const b = Number(base) || 0;
    const v = Number(value) || 0;
    if (b <= 0 || v <= 0 || b < (Number(min) || 0)) return 0;
    let amount = type === 'flat' ? v : (b * v) / 100;
    const cap = Number(max) || 0;
    if (type === 'percentage' && cap > 0) amount = Math.min(amount, cap);
    return Math.max(0, Math.floor(round2(amount)));
}

/** Rules live right now: active, started, not ended. */
export const liveWindow = (now = new Date()) => ({
    status: 'active',
    $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
    ],
});
