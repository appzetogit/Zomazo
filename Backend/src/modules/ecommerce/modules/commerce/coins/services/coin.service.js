import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { CoinLot, CoinLedger, CoinSettings } from '../models/coin.model.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toOid = (id, what = 'id') => {
    const s = String(id || '');
    if (!mongoose.Types.ObjectId.isValid(s)) throw new ValidationError(`Invalid ${what}`);
    return new mongoose.Types.ObjectId(s);
};

const wholeCoins = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
};

// ---- settings ---------------------------------------------------------------

const SETTING_FIELDS = ['isEnabled', 'redeemPercent', 'expiryDays', 'maxOrderPercent', 'coinValue'];

export async function getCoinSettings() {
    const doc = await CoinSettings.findOneAndUpdate(
        { key: 'default' },
        { $setOnInsert: { key: 'default' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return doc;
}

export async function updateCoinSettings(body = {}) {
    const set = {};
    for (const field of SETTING_FIELDS) {
        if (body[field] === undefined) continue;
        if (field === 'isEnabled') {
            set.isEnabled = body.isEnabled === true || body.isEnabled === 'true';
            continue;
        }
        const n = Number(body[field]);
        if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${field} must be a positive number`);
        if ((field === 'redeemPercent' || field === 'maxOrderPercent') && n > 100) {
            throw new ValidationError(`${field} cannot be above 100`);
        }
        if (field === 'expiryDays' && n < 1) throw new ValidationError('expiryDays must be at least 1');
        set[field] = n;
    }
    await getCoinSettings();
    // Only future credits pick up a new redeem percentage or expiry: a lot's
    // terms are fixed when it is credited.
    return CoinSettings.findOneAndUpdate({ key: 'default' }, { $set: set }, { new: true, runValidators: true }).lean();
}

// ---- crediting -------------------------------------------------------------

/**
 * Credits a lot of coins.
 *
 * Only refund coins carry the redeem percentage (the SOW's 80% rule). Rewards
 * and admin grants are spendable in full unless `spendablePercent` says
 * otherwise. With a `refId` the credit happens once however often it is retried.
 */
export async function creditCoins({
    userId,
    amount,
    source,
    refId = null,
    note = '',
    actorId = null,
    spendablePercent,
    expiresAt,
}) {
    const coins = wholeCoins(amount);
    if (!coins) throw new ValidationError('Coin amount must be a positive whole number');
    const settings = await getCoinSettings();
    const percent = spendablePercent ?? (source === 'refund' ? settings.redeemPercent : 100);
    const spendable = Math.floor((coins * percent) / 100);
    const lotExpiry = expiresAt || new Date(Date.now() + settings.expiryDays * DAY_MS);
    const user = toOid(userId, 'user id');

    let lot;
    try {
        lot = await CoinLot.create({
            userId: user,
            amount: coins,
            spendable,
            expiresAt: lotExpiry,
            source,
            refId: refId ? String(refId) : null,
            note,
        });
    } catch (err) {
        if (err?.code === 11000 && refId) {
            // Already credited for this refund / reward.
            return { lot: await CoinLot.findOne({ source, refId: String(refId) }).lean(), duplicate: true };
        }
        throw err;
    }

    await CoinLedger.create({
        userId: user,
        type: 'credit',
        amount: coins,
        spendable,
        source,
        refId: refId ? String(refId) : null,
        note,
        actorId,
    });
    pushToUser(user, {
        title: 'Coins credited',
        body: `${coins} coins were added to your wallet${spendable < coins ? ` (${spendable} usable)` : ''}.`,
        data: { type: 'coins_credited', coins: String(coins), source: String(source || '') },
    });
    return { lot: lot.toObject(), duplicate: false };
}

/** Fire-and-forget push; a notification never fails a coin operation. */
function pushToUser(userId, payload) {
    import('../../../../core/notifications/firebase.service.js')
        .then(({ notifyOwnerSafely }) => notifyOwnerSafely({ ownerType: 'USER', ownerId: String(userId) }, payload))
        .catch((err) => logger.warn(`coin push failed: ${err.message}`));
}

// ---- balance ---------------------------------------------------------------

const activeLotFilter = (userId, now) => ({
    userId,
    expiredAt: null,
    expiresAt: { $gt: now },
});

/**
 * `coins` is what the customer holds; `usable` is how many of them can still
 * be spent (the rest of each refund lot is never redeemable).
 */
export async function getCoinBalance(userId, now = new Date()) {
    const user = toOid(userId, 'user id');
    const settings = await getCoinSettings();
    const soon = new Date(now.getTime() + 7 * DAY_MS);
    const [row] = await CoinLot.aggregate([
        { $match: activeLotFilter(user, now) },
        {
            $group: {
                _id: null,
                coins: { $sum: { $subtract: ['$amount', '$used'] } },
                usable: { $sum: { $subtract: ['$spendable', '$used'] } },
                expiringSoon: {
                    $sum: { $cond: [{ $lte: ['$expiresAt', soon] }, { $subtract: ['$spendable', '$used'] }, 0] },
                },
                nextExpiry: { $min: { $cond: [{ $gt: ['$spendable', '$used'] }, '$expiresAt', null] } },
            },
        },
    ]);
    const usable = Math.max(0, row?.usable || 0);
    return {
        coins: Math.max(0, row?.coins || 0),
        usable,
        usableValue: usable * settings.coinValue,
        expiringSoon: Math.max(0, row?.expiringSoon || 0),
        nextExpiry: row?.nextExpiry || null,
        isEnabled: settings.isEnabled,
    };
}

/** How many coins may pay towards an order of this total. */
export async function getRedeemableForOrder(userId, orderTotal, now = new Date()) {
    const settings = await getCoinSettings();
    if (!settings.isEnabled || !(settings.coinValue > 0)) return { coins: 0, value: 0 };
    const { usable } = await getCoinBalance(userId, now);
    const capValue = (Math.max(0, Number(orderTotal) || 0) * settings.maxOrderPercent) / 100;
    const coins = Math.max(0, Math.min(usable, Math.floor(capValue / settings.coinValue)));
    return { coins, value: coins * settings.coinValue };
}

// ---- spending --------------------------------------------------------------

/** Puts coins back on the lots they came from. Never throws. */
async function releaseAllocations(allocations = []) {
    for (const a of allocations) {
        try {
            await CoinLot.updateOne({ _id: a.lotId }, { $inc: { used: -a.amount } });
        } catch (err) {
            logger.error(`[CRITICAL] coin release failed for lot ${a.lotId} (+${a.amount}): ${err?.message || err}`);
        }
    }
}

/**
 * Takes coins from a user's lots, soonest-expiring first.
 *
 * Each lot is claimed with a conditional update, so two orders spending at the
 * same moment cannot both take the same coins; a lot someone else just drained
 * is skipped and the next one tried. Takes all or nothing.
 */
async function takeCoins(userId, coins, now) {
    const taken = new Map();
    let need = coins;
    for (let attempt = 0; need > 0 && attempt < 25; attempt++) {
        const lots = await CoinLot.find({
            ...activeLotFilter(userId, now),
            $expr: { $lt: ['$used', '$spendable'] },
        })
            .sort({ expiresAt: 1, _id: 1 })
            .select('_id used spendable')
            .lean();
        if (!lots.length) break;
        for (const lot of lots) {
            if (need <= 0) break;
            const take = Math.min(need, lot.spendable - lot.used);
            if (take <= 0) continue;
            const res = await CoinLot.updateOne(
                {
                    _id: lot._id,
                    expiredAt: null,
                    expiresAt: { $gt: now },
                    $expr: { $lte: [{ $add: ['$used', take] }, '$spendable'] },
                },
                { $inc: { used: take } }
            );
            if (res.modifiedCount === 1) {
                taken.set(String(lot._id), (taken.get(String(lot._id)) || 0) + take);
                need -= take;
            }
        }
    }
    const allocations = [...taken].map(([lotId, amount]) => ({ lotId: new mongoose.Types.ObjectId(lotId), amount }));
    if (need > 0) {
        await releaseAllocations(allocations);
        return null;
    }
    return allocations;
}

/**
 * Spends coins on an order, once per order. Refuses more than the order's cap
 * allows; the caller works out the cap with getRedeemableForOrder.
 */
export async function redeemCoins({ userId, orderId, coins, now = new Date() }) {
    const want = wholeCoins(coins);
    if (!want) return { redeemed: 0 };
    const settings = await getCoinSettings();
    if (!settings.isEnabled) throw new ValidationError('Coins cannot be used right now');
    const user = toOid(userId, 'user id');
    const order = toOid(orderId, 'order id');

    const existing = await CoinLedger.findOne({ type: 'debit', orderId: order }).lean();
    if (existing) return { redeemed: existing.amount, ledgerId: existing._id, duplicate: true };

    const allocations = await takeCoins(user, want, now);
    if (!allocations) throw new ValidationError('Not enough coins');

    try {
        const entry = await CoinLedger.create({
            userId: user,
            type: 'debit',
            amount: want,
            orderId: order,
            allocations,
        });
        return { redeemed: want, value: want * settings.coinValue, ledgerId: entry._id };
    } catch (err) {
        // A concurrent retry of the same order won the ledger insert: give these back.
        await releaseAllocations(allocations);
        if (err?.code === 11000) {
            const winner = await CoinLedger.findOne({ type: 'debit', orderId: order }).lean();
            return { redeemed: winner.amount, ledgerId: winner._id, duplicate: true };
        }
        throw err;
    }
}

/**
 * Gives back coins spent on a redemption, up to what is left of it.
 *
 * A split checkout spends its coins once, across several stores' orders; when
 * one of them is cancelled only its share comes back (`coins`), and when the
 * whole redemption is undone everything left comes back (`coins` omitted).
 * Each return happens once per `refId`, and the total never exceeds what was
 * spent: both are enforced in the database, not by reading first.
 *
 * Coins go back to the lots they came from, most recently drawn first. A lot
 * that expired in the meantime is not revived; its share comes back as a
 * fresh, fully spendable lot, since those coins already carried their limit.
 */
export async function returnRedeemedCoins({ redemptionId, coins = null, refId, note = '' }) {
    const rid = toOid(redemptionId, 'order id');
    if (!refId) throw new ValidationError('refId is required');
    const debit = await CoinLedger.findOne({ type: 'debit', orderId: rid }).lean();
    if (!debit) return { returned: 0 };
    const remaining = debit.amount - (debit.returned || 0);
    const want = coins == null ? remaining : Math.min(wholeCoins(coins), remaining);
    if (want <= 0) return { returned: 0 };

    // One return per reference.
    let entry;
    try {
        entry = await CoinLedger.create({ userId: debit.userId, type: 'reversal', amount: want, refId: String(refId), note });
    } catch (err) {
        if (err?.code === 11000) return { returned: 0, duplicate: true };
        throw err;
    }

    // Never more than was spent, even with several cancellations at once.
    const claimed = await CoinLedger.findOneAndUpdate(
        { _id: debit._id, $expr: { $lte: [{ $add: [{ $ifNull: ['$returned', 0] }, want] }, '$amount'] } },
        { $inc: { returned: want } },
        { new: true }
    ).lean();
    if (!claimed) {
        await CoinLedger.deleteOne({ _id: entry._id });
        return { returned: 0 };
    }
    if (claimed.returned >= claimed.amount) {
        await CoinLedger.updateOne({ _id: debit._id, reversedAt: null }, { $set: { reversedAt: new Date() } });
    }

    const now = new Date();
    let left = want;
    let lapsed = 0;
    for (let attempt = 0; left > 0 && attempt < 10; attempt++) {
        const current = await CoinLedger.findById(debit._id).select('allocations').lean();
        for (const a of [...(current.allocations || [])].reverse()) {
            if (left <= 0) break;
            const already = a.returned || 0;
            const give = Math.min(left, a.amount - already);
            if (give <= 0) continue;
            // Optimistic: only if nobody else returned to this lot since we read it.
            const res = await CoinLedger.updateOne(
                { _id: debit._id, allocations: { $elemMatch: { lotId: a.lotId, returned: already } } },
                { $inc: { 'allocations.$.returned': give } }
            );
            if (res.modifiedCount !== 1) continue;
            left -= give;
            const lot = await CoinLot.updateOne(
                { _id: a.lotId, expiredAt: null, expiresAt: { $gt: now } },
                { $inc: { used: -give } }
            );
            if (lot.modifiedCount !== 1) lapsed += give;
        }
    }
    if (left > 0) {
        logger.error(`[CRITICAL] coin return for ${rid} (${refId}) could not place ${left} coins on their lots`);
        lapsed += left;
    }
    if (lapsed) {
        await creditCoins({
            userId: debit.userId,
            amount: lapsed,
            source: 'reversal',
            refId: `${refId}:lapsed`,
            spendablePercent: 100,
            note: 'Returned from a cancelled order',
        });
    }
    return { returned: want };
}

/** Undoes a whole redemption, once. */
export async function reverseRedemption(orderId, { note = '' } = {}) {
    const { returned } = await returnRedeemedCoins({ redemptionId: orderId, refId: `order:${orderId}`, note });
    return { reversed: returned };
}

// ---- admin -----------------------------------------------------------------

/** Adds (positive) or removes (negative) coins by hand. A reason is required. */
export async function adjustCoins({ userId, amount, reason, actorId }) {
    const n = Math.trunc(Number(amount));
    if (!Number.isFinite(n) || n === 0) throw new ValidationError('amount must be a non-zero whole number');
    const note = String(reason || '').trim();
    if (!note) throw new ValidationError('A reason is required');
    const user = toOid(userId, 'user id');

    if (n > 0) {
        const { lot } = await creditCoins({ userId: user, amount: n, source: 'admin', note, actorId });
        return { adjusted: n, lotId: lot._id };
    }
    const allocations = await takeCoins(user, -n, new Date());
    if (!allocations) throw new ValidationError('The customer does not have that many usable coins');
    await CoinLedger.create({ userId: user, type: 'adjust', amount: -n, allocations, note, actorId });
    return { adjusted: n };
}

export async function listCoinLedger(userId, { page = 1, limit = 20 } = {}) {
    const user = toOid(userId, 'user id');
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const [entries, total] = await Promise.all([
        CoinLedger.find({ userId: user }).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l)
            .select('-allocations').lean(),
        CoinLedger.countDocuments({ userId: user }),
    ]);
    // Coins in are positive, coins out negative, whatever sign was stored.
    const SIGN = { credit: 1, reversal: 1, debit: -1, expire: -1, adjust: -1 };
    const withSign = entries.map((e) => ({ ...e, signedAmount: (SIGN[e.type] || 1) * Math.abs(Number(e.amount) || 0) }));
    return { entries: withSign, total, page: p, limit: l, totalPages: Math.max(1, Math.ceil(total / l)) };
}

/**
 * Lots with coins left that expire within `days` (1-365, default 30). Each
 * row says how many of its coins can still be spent and how many are locked
 * (the part of a lot above its spendable share).
 */
export async function listExpiringLots(userId, { days = 30, now = new Date() } = {}) {
    const user = toOid(userId, 'user id');
    const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
    const until = new Date(now.getTime() + d * DAY_MS);
    const lots = await CoinLot.find({ ...activeLotFilter(user, now), expiresAt: { $gt: now, $lte: until } })
        .sort({ expiresAt: 1 }).select('amount spendable used expiresAt source').lean();
    const rows = lots
        .map((lot) => {
            const left = Math.max(0, lot.amount - lot.used);
            const usable = Math.max(0, lot.spendable - lot.used);
            return { lotId: String(lot._id), expiresAt: lot.expiresAt, source: lot.source || '', coins: left, usable, locked: Math.max(0, left - usable) };
        })
        .filter((r) => r.coins > 0);
    return { days: d, until, total: rows.reduce((s, r) => s + r.coins, 0), lots: rows };
}

/** What the platform owes in coins, and where issued coins went. */
export async function getCoinReport(now = new Date()) {
    const settings = await getCoinSettings();
    // Coins handed back from a cancelled order are already counted by the
    // reversal entry, so their re-credit is not new issuance.
    const byType = await CoinLedger.aggregate([
        { $match: { $nor: [{ type: 'credit', source: 'reversal' }] } },
        { $group: { _id: '$type', amount: { $sum: '$amount' }, spendable: { $sum: '$spendable' } } },
    ]);
    const sum = (type, field = 'amount') => byType.find((r) => r._id === type)?.[field] || 0;
    const [outstanding] = await CoinLot.aggregate([
        { $match: { expiredAt: null, expiresAt: { $gt: now } } },
        { $group: { _id: null, usable: { $sum: { $subtract: ['$spendable', '$used'] } } } },
    ]);
    const outstandingUsable = Math.max(0, outstanding?.usable || 0);
    return {
        credited: sum('credit'),
        creditedSpendable: sum('credit', 'spendable'),
        redeemed: sum('debit') - sum('reversal'),
        expired: sum('expire'),
        removedByAdmin: sum('adjust'),
        outstandingUsable,
        outstandingValue: outstandingUsable * settings.coinValue,
    };
}

// ---- expiry ----------------------------------------------------------------

/**
 * Closes lots whose date has passed and records what was lost. Balances never
 * count an expired lot anyway; this is for the history and the report.
 */
/**
 * Reminds customers once per lot that usable coins expire within `days`.
 * The flag is claimed atomically, so overlapping runs cannot double-send.
 */
export async function notifyExpiringCoins(now = new Date(), days = 3) {
    const horizon = new Date(now.getTime() + days * DAY_MS);
    let notified = 0;
    for (;;) {
        const lot = await CoinLot.findOneAndUpdate(
            { expiredAt: null, expiryNotifiedAt: null, expiresAt: { $gt: now, $lte: horizon } },
            { $set: { expiryNotifiedAt: now } },
            { new: true }
        ).lean();
        if (!lot) break;
        const left = Math.max(0, lot.spendable - lot.used);
        if (!left) continue;
        pushToUser(lot.userId, {
            title: 'Coins expiring soon',
            body: `${left} coins expire on ${lot.expiresAt.toISOString().slice(0, 10)}. Use them before they go.`,
            data: { type: 'coins_expiring', coins: String(left), expiresAt: lot.expiresAt.toISOString() },
        });
        notified++;
    }
    return { notified };
}

export async function expireDueLots(now = new Date()) {
    let expired = 0;
    for (;;) {
        const lot = await CoinLot.findOneAndUpdate(
            { expiredAt: null, expiresAt: { $lte: now } },
            { $set: { expiredAt: now } },
            { new: true }
        ).lean();
        if (!lot) break;
        const lost = lot.amount - lot.used;
        if (lost > 0) {
            await CoinLedger.create({ userId: lot.userId, type: 'expire', amount: lost, refId: String(lot._id) });
        }
        expired++;
    }
    return { expired };
}
