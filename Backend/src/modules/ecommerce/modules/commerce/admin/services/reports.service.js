/**
 * Admin reports: delivery SLA, seller commission, coin liability.
 *
 * All three take a date range (`from`/`to`, ISO dates; `to` is inclusive of the
 * whole day when given as YYYY-MM-DD) and, where orders are involved, an
 * optional `fulfilmentMode` ('quick' | 'standard'). Orders are selected by the
 * date they were placed (createdAt).
 */
import mongoose from 'mongoose';
import { Order } from '../../orders/models/order.model.js';
import { CoinLot, CoinLedger } from '../../coins/models/coin.model.js';
import { getCoinReport, getCoinSettings } from '../../coins/services/coin.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const MAX_RANGE_DAYS = 366;
export const DEFAULT_QUICK_SLA_MINUTES = 30;
const MODES = ['quick', 'standard'];
const CANCELLED = ['cancelled_by_user', 'cancelled_by_seller', 'cancelled_by_admin', 'pending_payment'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseDate(value, name, endOfDay = false) {
    if (value === undefined || value === null || value === '') return null;
    const s = String(value);
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new ValidationError(`${name} must be a valid date`);
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(d.getTime() + DAY_MS - 1);
    return d;
}

/** Validates and normalises the common query: from/to/fulfilmentMode/sellerId. */
export function parseReportQuery(query = {}, now = new Date()) {
    const to = parseDate(query.to ?? query.toDate, 'to', true) || now;
    const from = parseDate(query.from ?? query.fromDate, 'from') || new Date(to.getTime() - 30 * DAY_MS);
    if (from > to) throw new ValidationError('from must be before to');
    if ((to - from) / DAY_MS > MAX_RANGE_DAYS) throw new ValidationError(`date range cannot exceed ${MAX_RANGE_DAYS} days`);
    const mode = query.fulfilmentMode ?? query.mode;
    if (mode !== undefined && mode !== '' && mode !== 'all' && !MODES.includes(mode)) {
        throw new ValidationError("fulfilmentMode must be 'quick' or 'standard'");
    }
    let sellerId = null;
    if (query.sellerId) {
        if (!mongoose.isValidObjectId(query.sellerId)) throw new ValidationError('sellerId is invalid');
        sellerId = new mongoose.Types.ObjectId(String(query.sellerId));
    }
    let quickSlaMinutes = DEFAULT_QUICK_SLA_MINUTES;
    if (query.quickSlaMinutes !== undefined && query.quickSlaMinutes !== '') {
        quickSlaMinutes = Number(query.quickSlaMinutes);
        if (!Number.isFinite(quickSlaMinutes) || quickSlaMinutes <= 0 || quickSlaMinutes > 24 * 60) {
            throw new ValidationError('quickSlaMinutes must be between 1 and 1440');
        }
    }
    return { from, to, fulfilmentMode: MODES.includes(mode) ? mode : null, sellerId, quickSlaMinutes };
}

function percentile(sorted, p) {
    if (!sorted.length) return null;
    // Nearest-rank percentile; the median of an even count is the mean of the middle two.
    if (p === 50) {
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const sellerLookup = [
    { $lookup: { from: 'sellers', localField: '_id', foreignField: '_id', as: 'seller', pipeline: [{ $project: { sellerName: 1 } }] } },
    { $addFields: { sellerName: { $ifNull: [{ $first: '$seller.sellerName' }, ''] } } },
    { $project: { seller: 0 } },
];

// ---- 1. Delivery SLA ---------------------------------------------------------

/**
 * Delivered orders placed in the range. Duration is placed (createdAt) to
 * delivered (deliveryState.deliveredAt, else the 'delivered' status entry,
 * else updatedAt): minutes for quick, days for standard.
 * On time: quick within the order's promised ETA if one is stored
 * (promisedEtaMinutes, snapshotted at order creation), else
 * quickSlaMinutes (30); standard by shipment.etd when present (orders with no
 * etd are counted but excluded from the on-time percentage).
 */
export async function getDeliverySlaReport(query = {}) {
    const q = parseReportQuery(query);
    const match = { orderStatus: 'delivered', createdAt: { $gte: q.from, $lte: q.to } };
    if (q.fulfilmentMode) match.fulfilmentMode = q.fulfilmentMode;
    if (q.sellerId) match.sellerId = q.sellerId;

    const rows = await Order.aggregate([
        { $match: match },
        {
            $project: {
                order_id: 1,
                sellerId: 1,
                placedAt: '$createdAt',
                mode: { $ifNull: ['$fulfilmentMode', 'quick'] },
                deliveredAt: {
                    $ifNull: [
                        '$deliveryState.deliveredAt',
                        {
                            $max: {
                                $map: {
                                    input: { $filter: { input: { $ifNull: ['$statusHistory', []] }, cond: { $eq: ['$$this.to', 'delivered'] } } },
                                    in: '$$this.at',
                                },
                            },
                        },
                        '$updatedAt',
                    ],
                },
                promisedEtaMinutes: { $ifNull: ['$promisedEtaMinutes', '$etaMinutes'] },
                etd: { $convert: { input: '$shipment.etd', to: 'date', onError: null, onNull: null } },
            },
        },
        { $addFields: { durationMs: { $subtract: ['$deliveredAt', '$placedAt'] } } },
        { $lookup: { from: 'sellers', localField: 'sellerId', foreignField: '_id', as: 's', pipeline: [{ $project: { sellerName: 1 } }] } },
        { $addFields: { sellerName: { $ifNull: [{ $first: '$s.sellerName' }, ''] } } },
        { $project: { s: 0 } },
        { $sort: { placedAt: 1 } },
    ]);

    const enrich = (r) => {
        const quick = r.mode === 'quick';
        const durationMs = Math.max(0, r.durationMs || 0);
        let onTime = null;
        let promised = null;
        if (quick) {
            promised = Number(r.promisedEtaMinutes) > 0 ? Number(r.promisedEtaMinutes) : q.quickSlaMinutes;
            onTime = durationMs <= promised * MIN_MS;
        } else if (r.etd) {
            promised = r.etd;
            onTime = r.deliveredAt <= r.etd;
        }
        return {
            orderId: String(r._id),
            order_id: r.order_id || '',
            sellerId: String(r.sellerId),
            sellerName: r.sellerName,
            fulfilmentMode: r.mode,
            placedAt: r.placedAt,
            deliveredAt: r.deliveredAt,
            duration: round2(quick ? durationMs / MIN_MS : durationMs / DAY_MS),
            unit: quick ? 'minutes' : 'days',
            promised,
            onTime,
        };
    };
    const orders = rows.map(enrich);

    const summarise = (list) => {
        const sorted = list.map((o) => o.duration).sort((a, b) => a - b);
        const judged = list.filter((o) => o.onTime !== null);
        const onTime = judged.filter((o) => o.onTime).length;
        return {
            count: list.length,
            median: sorted.length ? round2(percentile(sorted, 50)) : null,
            p90: sorted.length ? round2(percentile(sorted, 90)) : null,
            judged: judged.length,
            onTime,
            late: judged.length - onTime,
            onTimePct: judged.length ? round2((onTime / judged.length) * 100) : null,
        };
    };

    const byMode = MODES.filter((m) => !q.fulfilmentMode || q.fulfilmentMode === m).map((m) => ({
        fulfilmentMode: m,
        unit: m === 'quick' ? 'minutes' : 'days',
        ...summarise(orders.filter((o) => o.fulfilmentMode === m)),
    }));

    const sellerKeys = new Map();
    for (const o of orders) {
        const key = `${o.sellerId}|${o.fulfilmentMode}`;
        if (!sellerKeys.has(key)) sellerKeys.set(key, []);
        sellerKeys.get(key).push(o);
    }
    const bySeller = [...sellerKeys.values()]
        .map((list) => ({
            sellerId: list[0].sellerId,
            sellerName: list[0].sellerName,
            fulfilmentMode: list[0].fulfilmentMode,
            unit: list[0].unit,
            ...summarise(list),
        }))
        .sort((a, b) => b.count - a.count);

    return {
        range: { from: q.from, to: q.to },
        fulfilmentMode: q.fulfilmentMode,
        quickSlaMinutes: q.quickSlaMinutes,
        byMode,
        bySeller,
        lateOrders: orders.filter((o) => o.onTime === false),
    };
}

// ---- 2. Commission -----------------------------------------------------------

/**
 * Per seller, for non-cancelled orders placed in the range. Commission and the
 * discount split come from the order's transaction when it has one (what was
 * actually booked), else from the order's own pricing. Coins are platform-borne
 * and do not reduce what the seller is owed.
 */
export async function getCommissionReport(query = {}) {
    const q = parseReportQuery(query);
    const match = { orderStatus: { $nin: CANCELLED }, createdAt: { $gte: q.from, $lte: q.to } };
    if (q.fulfilmentMode) match.fulfilmentMode = q.fulfilmentMode;
    if (q.sellerId) match.sellerId = q.sellerId;

    const rows = await Order.aggregate([
        { $match: match },
        { $lookup: { from: 'order_transactions', localField: '_id', foreignField: 'orderId', as: 't', pipeline: [{ $project: { amounts: 1 } }] } },
        { $addFields: { t: { $first: '$t' } } },
        {
            $project: {
                sellerId: 1,
                gross: { $ifNull: ['$pricing.subtotal', 0] },
                packaging: { $ifNull: ['$pricing.packagingFee', 0] },
                commission: { $ifNull: ['$t.amounts.sellerCommission', { $ifNull: ['$pricing.sellerCommission', 0] }] },
                sellerDiscount: { $ifNull: ['$t.amounts.sellerDiscountShare', 0] },
                platformDiscount: {
                    $ifNull: [
                        '$t.amounts.adminDiscountShare',
                        // No transaction: the whole coupon discount is unattributed; count it as platform-funded.
                        { $ifNull: ['$pricing.discount', 0] },
                    ],
                },
                coinsDiscount: { $ifNull: ['$coinsDiscount', 0] },
                sellerShare: '$t.amounts.sellerShare',
            },
        },
        {
            $addFields: {
                netPayable: {
                    $ifNull: [
                        '$sellerShare',
                        { $max: [0, { $subtract: [{ $add: ['$gross', '$packaging'] }, { $add: ['$commission', '$sellerDiscount'] }] }] },
                    ],
                },
            },
        },
        {
            $group: {
                _id: '$sellerId',
                orders: { $sum: 1 },
                grossItemValue: { $sum: '$gross' },
                commission: { $sum: '$commission' },
                sellerFundedDiscount: { $sum: '$sellerDiscount' },
                platformFundedDiscount: { $sum: '$platformDiscount' },
                coinsDiscount: { $sum: '$coinsDiscount' },
                netPayable: { $sum: '$netPayable' },
            },
        },
        ...sellerLookup,
        { $sort: { grossItemValue: -1 } },
    ]);

    const fields = ['orders', 'grossItemValue', 'commission', 'sellerFundedDiscount', 'platformFundedDiscount', 'coinsDiscount', 'netPayable'];
    const sellers = rows.map((r) => {
        const out = { sellerId: String(r._id), sellerName: r.sellerName };
        for (const f of fields) out[f] = f === 'orders' ? r[f] : round2(r[f]);
        out.commissionPct = r.grossItemValue ? round2((r.commission / r.grossItemValue) * 100) : 0;
        return out;
    });
    const totals = { sellerName: 'Total' };
    for (const f of fields) totals[f] = round2(sellers.reduce((s, r) => s + r[f], 0));
    totals.commissionPct = totals.grossItemValue ? round2((totals.commission / totals.grossItemValue) * 100) : 0;

    return { range: { from: q.from, to: q.to }, fulfilmentMode: q.fulfilmentMode, sellers, totals };
}

// ---- 3. Coin liability ---------------------------------------------------------

/**
 * Outstanding coins right now (per lot: amount - used, unexpired), split into
 * the spendable part (spendable - used) and the part that can never be spent;
 * how much of the spendable part expires within 7/30/90 days; and movements in
 * the range by source. Extends coin.service getCoinReport (returned as allTime).
 */
export async function getCoinLiabilityReport(query = {}, now = new Date()) {
    const q = parseReportQuery(query, now);
    const settings = await getCoinSettings();
    const horizon = (d) => new Date(now.getTime() + d * DAY_MS);
    const remainingSpendable = { $max: [0, { $subtract: ['$spendable', '$used'] }] };
    const remaining = { $max: [0, { $subtract: ['$amount', '$used'] }] };
    const expiringIn = (d) => ({ $sum: { $cond: [{ $lte: ['$expiresAt', horizon(d)] }, remainingSpendable, 0] } });

    const [outstandingRows, issued, redeemed, returned, expired, allTime] = await Promise.all([
        CoinLot.aggregate([
            { $match: { expiredAt: null, expiresAt: { $gt: now } } },
            {
                $group: {
                    _id: '$source',
                    lots: { $sum: 1 },
                    outstanding: { $sum: remaining },
                    spendable: { $sum: remainingSpendable },
                    expiring7: expiringIn(7),
                    expiring30: expiringIn(30),
                    expiring90: expiringIn(90),
                },
            },
        ]),
        // Re-credits of cancelled-order coins are returns, not new issuance.
        CoinLedger.aggregate([
            { $match: { type: 'credit', source: { $ne: 'reversal' }, createdAt: { $gte: q.from, $lte: q.to } } },
            { $group: { _id: '$source', amount: { $sum: '$amount' }, spendable: { $sum: { $ifNull: ['$spendable', '$amount'] } } } },
        ]),
        // Redemptions attributed to the lots they drew from.
        CoinLedger.aggregate([
            { $match: { type: 'debit', createdAt: { $gte: q.from, $lte: q.to } } },
            { $unwind: '$allocations' },
            { $lookup: { from: 'coin_lots', localField: 'allocations.lotId', foreignField: '_id', as: 'lot', pipeline: [{ $project: { source: 1 } }] } },
            { $group: { _id: { $ifNull: [{ $first: '$lot.source' }, 'unknown'] }, amount: { $sum: '$allocations.amount' } } },
        ]),
        CoinLedger.aggregate([
            { $match: { type: 'reversal', createdAt: { $gte: q.from, $lte: q.to } } },
            { $group: { _id: null, amount: { $sum: '$amount' } } },
        ]),
        // Expiry entries carry the lot id as refId.
        CoinLedger.aggregate([
            { $match: { type: 'expire', createdAt: { $gte: q.from, $lte: q.to } } },
            { $addFields: { lotId: { $convert: { input: '$refId', to: 'objectId', onError: null, onNull: null } } } },
            { $lookup: { from: 'coin_lots', localField: 'lotId', foreignField: '_id', as: 'lot', pipeline: [{ $project: { source: 1 } }] } },
            { $group: { _id: { $ifNull: [{ $first: '$lot.source' }, 'unknown'] }, amount: { $sum: '$amount' } } },
        ]),
        getCoinReport(now),
    ]);

    const sources = new Set([...outstandingRows, ...issued, ...redeemed, ...expired].map((r) => r._id));
    const pick = (list, src, f = 'amount') => list.find((r) => r._id === src)?.[f] || 0;
    const bySource = [...sources].sort().map((source) => {
        const outstanding = pick(outstandingRows, source, 'outstanding');
        const spendable = pick(outstandingRows, source, 'spendable');
        return {
            source,
            outstanding,
            spendable,
            neverSpendable: outstanding - spendable,
            expiring7: pick(outstandingRows, source, 'expiring7'),
            expiring30: pick(outstandingRows, source, 'expiring30'),
            expiring90: pick(outstandingRows, source, 'expiring90'),
            issued: pick(issued, source),
            redeemed: pick(redeemed, source),
            expired: pick(expired, source),
        };
    });
    const sum = (f) => bySource.reduce((s, r) => s + r[f], 0);
    const outstanding = {
        total: sum('outstanding'),
        spendable: sum('spendable'),
        neverSpendable: sum('neverSpendable'),
        spendableValue: round2(sum('spendable') * settings.coinValue),
        expiring: { days7: sum('expiring7'), days30: sum('expiring30'), days90: sum('expiring90') },
    };
    const redeemedGross = sum('redeemed');
    const returnedAmount = returned[0]?.amount || 0;

    return {
        asOf: now,
        range: { from: q.from, to: q.to },
        coinValue: settings.coinValue,
        outstanding,
        period: {
            issued: sum('issued'),
            issuedSpendable: issued.reduce((s, r) => s + r.spendable, 0),
            redeemed: redeemedGross,
            returned: returnedAmount,
            netRedeemed: redeemedGross - returnedAmount,
            expired: sum('expired'),
        },
        bySource,
        allTime,
    };
}
