/**
 * Admin > Cashback, Wallet Bonus and Loyalty Points (rewards.model.js,
 * core/loyalty).
 *
 * Who may, the same rule as platform coupons (platformCouponAdmin.service.js):
 * looking needs `promotions` in any service; changing a cashback offer needs it
 * in every service the offer names. A wallet bonus and the loyalty rules pay
 * from the one wallet whichever service the customer uses, so changing them
 * needs `promotions` in every service a customer can top up or earn in -- in
 * practice a platform owner or an all-services offers admin.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { canManagePlatformCoupon, canSeePlatformCoupons } from './platformCouponAdmin.service.js';
import { CashbackOffer, WalletBonus, REWARD_SERVICES } from './rewards.model.js';
import { getLoyaltySettings, loyaltyReport, saveLoyaltySettings } from '../loyalty/loyalty.service.js';

const WALLET_SERVICES = ['food', 'quickCommerce', 'ecommerce', 'taxi'];
// The services whose completed orders call rewardCompletedOrder (orderRewards.js).
const CASHBACK_SERVICES = WALLET_SERVICES;

const mustSee = (admin) => {
    if (!canSeePlatformCoupons(admin)) throw new ApiError(403, 'You do not have access to offers');
};
const mustManage = (admin, services) => {
    if (!canManagePlatformCoupon(admin, services, true)) {
        throw new ApiError(403, 'You need offers access in every service this applies to');
    }
};

const num = (v, name, { min = 0, max = Infinity } = {}) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, `${name} must be a number from ${min}${Number.isFinite(max) ? ` to ${max}` : ''}`);
    return n;
};
// An end date is the whole of that day: "ends 31 Oct" still pays on 31 Oct.
const when = (v, name, { endOfDay = false } = {}) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `${name} is not a date`);
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) d.setUTCHours(23, 59, 59, 999);
    return d;
};
const oid = (id) => {
    if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw new ApiError(404, 'Not found');
    return new mongoose.Types.ObjectId(String(id));
};
const status = (v) => {
    if (v === undefined) return undefined;
    if (!['active', 'paused'].includes(v)) throw new ApiError(400, 'Status must be active or paused');
    return v;
};
const checkWindow = (doc) => {
    if (doc.startDate && doc.endDate && doc.endDate < doc.startDate) throw new ApiError(400, 'End date is before the start date');
};
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/* ---------------- Cashback offers ---------------- */

function readCashback(body = {}, { creating }) {
    const out = {};
    if (creating || body.title !== undefined) {
        out.title = String(body.title || '').trim().slice(0, 80);
        if (!out.title) throw new ApiError(400, 'Title is required');
    }
    if (creating || body.services !== undefined) {
        const services = [...new Set((Array.isArray(body.services) ? body.services : []).map(String))];
        if (!services.length) throw new ApiError(400, 'Pick at least one service');
        // Services bookings have no completion hook paying cashback yet.
        const unknown = services.filter((s) => !CASHBACK_SERVICES.includes(s));
        if (unknown.length) throw new ApiError(400, `Cashback is not paid in: ${unknown.join(', ')}`);
        out.services = services;
    }
    if (creating || body.cashbackType !== undefined) {
        if (!['percentage', 'flat'].includes(body.cashbackType)) throw new ApiError(400, 'Cashback type must be percentage or flat');
        out.cashbackType = body.cashbackType;
    }
    const pct = (out.cashbackType || body.cashbackType) === 'percentage';
    out.cashbackValue = num(body.cashbackValue, 'Cashback', { min: 0, max: pct ? 100 : 100000 });
    if (creating && !(out.cashbackValue > 0)) throw new ApiError(400, 'Cashback must be more than 0');
    out.maxCashback = num(body.maxCashback, 'Maximum cashback', { max: 100000 });
    out.minOrderValue = num(body.minOrderValue, 'Minimum order', { max: 10000000 });
    out.perUserLimit = num(body.perUserLimit, 'Limit per customer', { max: 100000 });
    out.startDate = when(body.startDate, 'Start date');
    out.endDate = when(body.endDate, 'End date', { endOfDay: true });
    out.status = status(body.status);
    return clean(out);
}

export async function listCashbackOffers(admin, query = {}) {
    mustSee(admin);
    const filter = {};
    if (['percentage', 'flat'].includes(query.type)) filter.cashbackType = query.type;
    if (REWARD_SERVICES.includes(query.service)) filter.services = query.service;
    const q = String(query.search || '').trim();
    if (q) filter.title = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return { items: await CashbackOffer.find(filter).sort({ createdAt: -1 }).limit(500).lean() };
}

export async function createCashbackOffer(admin, body) {
    const doc = readCashback(body, { creating: true });
    mustManage(admin, doc.services);
    checkWindow(doc);
    return CashbackOffer.create({ ...doc, createdBy: admin?._id || null });
}

export async function updateCashbackOffer(admin, id, body) {
    const offer = await CashbackOffer.findById(oid(id));
    if (!offer) throw new ApiError(404, 'Cashback offer not found');
    mustManage(admin, offer.services);
    const changes = readCashback(body, { creating: false });
    if (changes.services) mustManage(admin, changes.services);
    offer.set(changes);
    checkWindow(offer);
    await offer.save();
    return offer.toObject();
}

export async function deleteCashbackOffer(admin, id) {
    const offer = await CashbackOffer.findById(oid(id)).lean();
    if (!offer) throw new ApiError(404, 'Cashback offer not found');
    mustManage(admin, offer.services);
    // Cashback already paid stays in the wallets; each row names its offer.
    await CashbackOffer.deleteOne({ _id: offer._id });
    return { deleted: true };
}

/* ---------------- Wallet bonuses ---------------- */

function readBonus(body = {}, { creating }) {
    const out = {};
    if (creating || body.title !== undefined) {
        out.title = String(body.title || '').trim().slice(0, 80);
        if (!out.title) throw new ApiError(400, 'Title is required');
    }
    if (body.description !== undefined) out.description = String(body.description || '').trim().slice(0, 300);
    if (creating || body.bonusType !== undefined) {
        if (!['percentage', 'flat'].includes(body.bonusType)) throw new ApiError(400, 'Bonus type must be percentage or flat');
        out.bonusType = body.bonusType;
    }
    const pct = (out.bonusType || body.bonusType) === 'percentage';
    out.bonusValue = num(body.bonusValue, 'Bonus', { min: 0, max: pct ? 100 : 100000 });
    if (creating && !(out.bonusValue > 0)) throw new ApiError(400, 'Bonus must be more than 0');
    out.minTopup = num(body.minTopup, 'Minimum top-up', { max: 1000000 });
    out.maxBonus = num(body.maxBonus, 'Maximum bonus', { max: 100000 });
    out.startDate = when(body.startDate, 'Start date');
    out.endDate = when(body.endDate, 'Expiry date', { endOfDay: true });
    out.status = status(body.status);
    return clean(out);
}

export async function listWalletBonuses(admin, query = {}) {
    mustSee(admin);
    const filter = {};
    const q = String(query.search || '').trim();
    if (q) filter.title = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return { items: await WalletBonus.find(filter).sort({ createdAt: -1 }).limit(500).lean() };
}

export async function createWalletBonus(admin, body) {
    mustManage(admin, WALLET_SERVICES);
    const doc = readBonus(body, { creating: true });
    checkWindow(doc);
    return WalletBonus.create({ ...doc, createdBy: admin?._id || null });
}

export async function updateWalletBonus(admin, id, body) {
    mustManage(admin, WALLET_SERVICES);
    const bonus = await WalletBonus.findById(oid(id));
    if (!bonus) throw new ApiError(404, 'Wallet bonus not found');
    bonus.set(readBonus(body, { creating: false }));
    checkWindow(bonus);
    await bonus.save();
    return bonus.toObject();
}

export async function deleteWalletBonus(admin, id) {
    mustManage(admin, WALLET_SERVICES);
    const res = await WalletBonus.deleteOne({ _id: oid(id) });
    if (!res.deletedCount) throw new ApiError(404, 'Wallet bonus not found');
    return { deleted: true };
}

/* ---------------- Loyalty points ---------------- */

export async function readLoyaltySettings(admin) {
    mustSee(admin);
    return getLoyaltySettings();
}

export async function writeLoyaltySettings(admin, body) {
    mustManage(admin, WALLET_SERVICES);
    if (body?.services !== undefined) {
        const unknown = (Array.isArray(body.services) ? body.services : []).filter((s) => !REWARD_SERVICES.includes(s));
        if (unknown.length) throw new ApiError(400, `Unknown service: ${unknown.join(', ')}`);
    }
    return saveLoyaltySettings(body || {}, admin?._id);
}

export async function readLoyaltyReport(admin, query) {
    mustSee(admin);
    return loyaltyReport(query);
}
