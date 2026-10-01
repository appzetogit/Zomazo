import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { walletOwner } from '../wallet/linkedWallet.js';
import { creditWalletOnce } from '../wallet/walletCredit.js';
import { LoyaltyAccount, LoyaltyLedger, LoyaltySettings } from './loyalty.model.js';

/**
 * Loyalty points (loyalty.model.js).
 *
 * Every service calls earnOrderPoints when an order completes, with its own
 * customer id; the points land on the customer's platform account, the same
 * one their wallet is keyed by (core/wallet/linkedWallet.js), so points earned
 * on Food and on the Shop add up and convert into the one wallet.
 */

const DEFAULTS = { isEnabled: false, pointsPerHundred: 0, pointsPerRupee: 10, minConvertPoints: 100, services: [] };

export async function getLoyaltySettings() {
    const doc = await LoyaltySettings.findOne({ key: 'default' }).lean();
    return { ...DEFAULTS, ...(doc || {}) };
}

export async function saveLoyaltySettings(body = {}, adminId = null) {
    const set = {};
    if (body.isEnabled !== undefined) set.isEnabled = Boolean(body.isEnabled);
    const num = (v, name, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, `${name} must be a number from ${min} to ${max}`);
        return n;
    };
    if (body.pointsPerHundred !== undefined) set.pointsPerHundred = num(body.pointsPerHundred, 'Points per Rs 100', 0, 1000);
    if (body.pointsPerRupee !== undefined) set.pointsPerRupee = num(body.pointsPerRupee, 'Points per Rs 1', 1, 100000);
    if (body.minConvertPoints !== undefined) set.minConvertPoints = Math.floor(num(body.minConvertPoints, 'Minimum points to convert', 1, 10000000));
    if (body.services !== undefined) set.services = (Array.isArray(body.services) ? body.services : []).map(String);
    set.updatedBy = mongoose.Types.ObjectId.isValid(String(adminId || '')) ? adminId : null;
    await LoyaltySettings.updateOne({ key: 'default' }, { $set: set, $setOnInsert: { key: 'default' } }, { upsert: true });
    return getLoyaltySettings();
}

/** Points an order of `amount` rupees earns under these settings. */
export const pointsFor = (settings, amount) =>
    Math.max(0, Math.floor(((Number(amount) || 0) * (Number(settings.pointsPerHundred) || 0)) / 100));

/**
 * Credit points for a completed order. Once per order: the ledger's unique
 * reference refuses a second earn. Never throws -- points must not fail a
 * delivery.
 * @returns {Promise<number>} points earned by this call
 */
export async function earnOrderPoints({ service, customerId, orderId, orderDisplayId = '', amount }) {
    try {
        const settings = await getLoyaltySettings();
        if (!settings.isEnabled) return 0;
        if (settings.services?.length && !settings.services.includes(service)) return 0;
        const points = pointsFor(settings, amount);
        if (points <= 0 || !customerId || !orderId) return 0;
        const platformUserId = await walletOwner(customerId);
        let entry;
        try {
            entry = await LoyaltyLedger.create({
                platformUserId, type: 'earn', points, service,
                orderId: String(orderId), orderDisplayId: String(orderDisplayId || orderId),
                referenceKey: `earn:${service}:${orderId}`,
            });
        } catch (err) {
            if (err?.code === 11000) return 0; // already earned
            throw err;
        }
        const account = await LoyaltyAccount.findOneAndUpdate(
            { platformUserId },
            { $inc: { balance: points, earned: points } },
            { upsert: true, new: true },
        ).lean();
        await LoyaltyLedger.updateOne({ _id: entry._id }, { $set: { balanceAfter: account.balance } });
        return points;
    } catch (err) {
        logger.warn(`Loyalty points not earned for ${service} order ${orderId}: ${err?.message || err}`);
        return 0;
    }
}

/**
 * Take back the points an order earned, in proportion to what was refunded,
 * once per `key` (the return), never more than earned and never below zero.
 * Never throws.
 * @returns {Promise<number>} points taken back by this call
 */
export async function reverseOrderPoints({ service, orderId, share = 1, key = 'full' }) {
    try {
        const earn = await LoyaltyLedger.findOne({ referenceKey: `earn:${service}:${orderId}` }).lean();
        if (!earn) return 0;
        const prior = await LoyaltyLedger.find({ type: 'reverse', service, orderId: String(orderId) }).select('points').lean();
        const already = prior.reduce((n, r) => n + (Number(r.points) || 0), 0);
        const ratio = Math.min(1, Math.max(0, Number(share) || 0));
        // Only from the points still held: points already converted into wallet
        // money stay converted (a product decision, 2026-10-01), so a refund can
        // take back less than the order earned.
        const account = await LoyaltyAccount.findOne({ platformUserId: earn.platformUserId }).lean();
        const points = Math.min(Math.round(earn.points * ratio), earn.points - already, Number(account?.balance) || 0);
        if (points <= 0) return 0;
        let entry;
        try {
            entry = await LoyaltyLedger.create({
                platformUserId: earn.platformUserId, type: 'reverse', points, service,
                orderId: String(orderId), orderDisplayId: earn.orderDisplayId,
                referenceKey: `reverse:${service}:${orderId}:${key}`,
            });
        } catch (err) {
            if (err?.code === 11000) return 0;
            throw err;
        }
        const after = await LoyaltyAccount.findOneAndUpdate(
            { platformUserId: earn.platformUserId, balance: { $gte: points } },
            { $inc: { balance: -points } },
            { new: true },
        ).lean();
        if (!after) {
            // Spent in between: record that nothing was taken.
            await LoyaltyLedger.updateOne({ _id: entry._id }, { $set: { points: 0 } });
            return 0;
        }
        await LoyaltyLedger.updateOne({ _id: entry._id }, { $set: { balanceAfter: after.balance } });
        return points;
    } catch (err) {
        logger.warn(`Loyalty points not reversed for ${service} order ${orderId}: ${err?.message || err}`);
        return 0;
    }
}

/** A customer's points, what they are worth, and the rules for converting. */
export async function getLoyaltySummary(customerId) {
    const [settings, platformUserId] = await Promise.all([getLoyaltySettings(), walletOwner(customerId)]);
    const [account, recent] = await Promise.all([
        LoyaltyAccount.findOne({ platformUserId }).lean(),
        LoyaltyLedger.find({ platformUserId, points: { $gt: 0 } }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const balance = Number(account?.balance) || 0;
    return {
        enabled: Boolean(settings.isEnabled),
        balance,
        earned: Number(account?.earned) || 0,
        converted: Number(account?.converted) || 0,
        pointsPerRupee: settings.pointsPerRupee,
        pointsPerHundred: settings.pointsPerHundred,
        minConvertPoints: settings.minConvertPoints,
        worth: Math.floor(balance / settings.pointsPerRupee),
        history: recent.map((r) => ({
            id: String(r._id), type: r.type, points: r.points, service: r.service,
            orderDisplayId: r.orderDisplayId, walletAmount: r.walletAmount, createdAt: r.createdAt,
        })),
    };
}

/**
 * Turn points into wallet money. Whole rupees only: asking to convert 125
 * points at 10 a rupee converts 120 and leaves 5.
 *
 * The points are spent by a conditional update first, so two conversions at
 * once cannot both spend the same points; the wallet credit then carries the
 * conversion's own reference, so it lands once. If the credit fails the points
 * are given back.
 */
export async function convertPoints(customerId, requested) {
    const settings = await getLoyaltySettings();
    if (!settings.isEnabled) throw new ApiError(400, 'Loyalty points are not available right now');
    const asked = Math.floor(Number(requested) || 0);
    if (asked < settings.minConvertPoints) throw new ApiError(400, `Convert at least ${settings.minConvertPoints} points`);
    const rupees = Math.floor(asked / settings.pointsPerRupee);
    const points = rupees * settings.pointsPerRupee;
    if (rupees <= 0) throw new ApiError(400, `${settings.pointsPerRupee} points make Rs 1`);

    const platformUserId = await walletOwner(customerId);
    const spent = await LoyaltyAccount.findOneAndUpdate(
        { platformUserId, balance: { $gte: points } },
        { $inc: { balance: -points, converted: points } },
        { new: true },
    ).lean();
    if (!spent) throw new ApiError(400, 'Not enough points');

    const referenceKey = `convert:${new mongoose.Types.ObjectId()}`;
    const entry = await LoyaltyLedger.create({
        platformUserId, type: 'convert', points, walletAmount: rupees,
        balanceAfter: spent.balance, referenceKey, status: 'pending',
    });
    try {
        await creditWalletOnce(platformUserId, {
            amount: rupees,
            description: `${points} loyalty points converted`,
            title: 'Loyalty points',
            referenceKey: `loyalty:${referenceKey}`,
            metadata: { source: 'loyalty_convert', points, ledgerId: String(entry._id) },
        });
    } catch (err) {
        await LoyaltyAccount.updateOne({ platformUserId }, { $inc: { balance: points, converted: -points } });
        await LoyaltyLedger.deleteOne({ _id: entry._id });
        logger.error(`Loyalty conversion failed for ${platformUserId}: ${err?.message || err}`);
        throw new ApiError(500, 'Could not convert points. Please try again.');
    }
    await LoyaltyLedger.updateOne({ _id: entry._id }, { $set: { status: 'completed' } });
    return { converted: points, amount: rupees, balance: spent.balance };
}

/**
 * Admin > Loyalty Point Report: every move, newest first, with the customer's
 * name and phone. Filters: from / to (dates), user (name or phone fragment, or
 * an account id), type.
 */
export async function loyaltyReport(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const filter = { points: { $gt: 0 } };
    if (['earn', 'convert', 'reverse'].includes(query.type)) filter.type = query.type;
    const range = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) range.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) {
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
    }
    if (Object.keys(range).length) filter.createdAt = range;

    const users = mongoose.connection.collection('users');
    const term = String(query.user || '').trim();
    if (term) {
        if (mongoose.Types.ObjectId.isValid(term)) {
            filter.platformUserId = new mongoose.Types.ObjectId(term);
        } else {
            const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const ids = await users.find({ $or: [{ name: rx }, { phone: rx }] }, { projection: { _id: 1 } }).limit(500).toArray();
            filter.platformUserId = { $in: ids.map((u) => u._id) };
        }
    }

    const [rows, total, totals] = await Promise.all([
        LoyaltyLedger.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        LoyaltyLedger.countDocuments(filter),
        LoyaltyLedger.aggregate([{ $match: filter }, { $group: { _id: '$type', points: { $sum: '$points' }, rupees: { $sum: '$walletAmount' } } }]),
    ]);
    const people = await users
        .find({ _id: { $in: [...new Set(rows.map((r) => String(r.platformUserId)))].map((id) => new mongoose.Types.ObjectId(id)) } }, { projection: { name: 1, phone: 1 } })
        .toArray();
    const byId = new Map(people.map((u) => [String(u._id), u]));
    const sum = (t) => totals.find((x) => x._id === t) || { points: 0, rupees: 0 };

    return {
        items: rows.map((r) => {
            const u = byId.get(String(r.platformUserId));
            const credit = r.type === 'earn' ? r.points : 0;
            return {
                id: String(r._id),
                transactionId: String(r._id).slice(-10).toUpperCase(),
                customerId: String(r.platformUserId),
                customer: u ? [u.name, u.phone].filter(Boolean).join(' · ') : 'Customer',
                credit,
                debit: credit ? 0 : r.points,
                balance: r.balanceAfter,
                transactionType: r.type === 'earn' ? 'Earned' : r.type === 'convert' ? 'Converted to wallet' : 'Taken back (refund)',
                type: r.type,
                reference: r.type === 'convert' ? `Rs ${r.walletAmount}` : [r.service, r.orderDisplayId].filter(Boolean).join(' '),
                walletAmount: r.walletAmount,
                createdAt: r.createdAt,
            };
        }),
        totals: {
            earned: sum('earn').points,
            converted: sum('convert').points,
            convertedRupees: sum('convert').rupees,
            reversed: sum('reverse').points,
        },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
}
