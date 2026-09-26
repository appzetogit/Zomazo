/**
 * Courier operations for Shop (standard) orders: the NDR queue (failed
 * delivery attempts), the RTO queue (shipments coming back to the seller) and
 * COD remittance reconciliation, plus a read-only COD summary for riders.
 */
import mongoose from 'mongoose';
import { Order } from '../models/order.model.js';
import { CodRemittance } from '../models/codRemittance.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { DeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import { DeliveryCashDeposit } from '../../delivery/models/deliveryCashDeposit.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { getShippingProvider } from '../../delivery/services/shipping/index.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { buildOrderIdentityFilter, notifyOwnerSafely } from './order.helpers.js';
import { restoreOrderStock, restockReturnedItems } from './inventory.service.js';
import { applyCancellationRefund } from './order.service.js';
import { channelForMode } from '../../shared/channels.js';

export const RTO_STATUSES = ['rto_initiated', 'rto_in_transit', 'rto_delivered', 'rto_received'];
const NDR_ACTIONS = ['reattempt', 'rto', 'contact'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function sellersFor(docs) {
    const ids = [...new Set(docs.map((d) => String(d.sellerId || '')).filter(Boolean))];
    const list = ids.length ? await Seller.find({ _id: { $in: ids } }).select('sellerName shopName').lean() : [];
    return new Map(list.map((s) => [String(s._id), { _id: String(s._id), name: s.sellerName || s.shopName || '' }]));
}

function baseRow(o, sellers) {
    return {
        _id: String(o._id),
        orderId: o.order_id || String(o._id),
        orderStatus: o.orderStatus,
        createdAt: o.createdAt,
        total: o.pricing?.total ?? 0,
        paymentMethod: o.payment?.method || '',
        paymentStatus: o.payment?.status || '',
        seller: sellers.get(String(o.sellerId)) || null,
        customer: {
            name: o.customerName || o.deliveryAddress?.fullName || o.deliveryAddress?.name || '',
            phone: o.customerPhone || o.deliveryAddress?.phone || '',
        },
        destination: { street: o.deliveryAddress?.street || '', city: o.deliveryAddress?.city || '', pincode: o.deliveryAddress?.zipCode || '' },
        shipment: o.shipment || null,
    };
}

async function loadCourierOrder(orderId) {
    const order = await Order.findOne({ ...buildOrderIdentityFilter(orderId), fulfilmentMode: 'standard' });
    if (!order) throw new NotFoundError('Courier order not found');
    return order;
}

// ---- tracking capture ------------------------------------------------------

/**
 * Called after every tracking read. Stores NDR details on the shipment (a new
 * attempt re-opens the NDR for action) and stamps the RTO leg when it starts.
 */
export async function captureTrackingEvents(orderId, awb, tracking = {}) {
    const status = String(tracking?.currentStatus || '').toLowerCase();
    const order = await Order.findOne({ _id: orderId, 'shipment.awb': awb }).select('shipment').lean();
    if (!order) return null;
    const s = order.shipment || {};
    const set = {};
    const now = new Date();

    const ndr = tracking?.ndr;
    if (ndr && (status === 'undelivered' || ndr.attempts)) {
        const prev = s.ndr || {};
        const attempts = Math.max(Number(ndr.attempts) || 1, Number(prev.attempts) || 0);
        const isNew = attempts > (Number(prev.attempts) || 0);
        set['shipment.ndr'] = {
            ...prev,
            attempts,
            lastReason: String(ndr.reason || prev.lastReason || '').slice(0, 300),
            lastAt: isNew ? (ndr.at ? new Date(ndr.at) : now) : prev.lastAt || now,
            firstAt: prev.firstAt || now,
            // A fresh failed attempt needs a fresh decision.
            pending: isNew ? true : prev.pending !== false,
            action: isNew ? null : prev.action ?? null,
            actionAt: isNew ? null : prev.actionAt ?? null,
            history: prev.history || [],
        };
    }
    if (RTO_STATUSES.includes(status) && !s.rto?.initiatedAt) {
        set['shipment.rto'] = { ...(s.rto || {}), initiatedAt: now, receivedAt: null };
    }
    if (status.startsWith('rto_') && s.ndr?.pending) set['shipment.ndr.pending'] = false;
    if (status === 'delivered' && s.ndr?.pending) set['shipment.ndr.pending'] = false;
    if (!Object.keys(set).length) return null;
    await Order.updateOne({ _id: orderId, 'shipment.awb': awb }, { $set: set });
    return set;
}

// ---- NDR -------------------------------------------------------------------

/** `state`: pending (default) | actioned | all. */
export async function listNdr(query = {}) {
    const { page, limit, skip } = buildPaginationOptions(query);
    const state = String(query.state || 'pending');
    const filter = { fulfilmentMode: 'standard', 'shipment.ndr.attempts': { $gte: 1 } };
    if (state === 'pending') filter['shipment.ndr.pending'] = true;
    else if (state === 'actioned') filter['shipment.ndr.pending'] = false;
    const q = String(query.search || '').trim();
    if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ order_id: rx }, { 'shipment.awb': rx }, { customerPhone: rx }];
    }
    const [docs, total] = await Promise.all([
        Order.find(filter).sort({ 'shipment.ndr.lastAt': -1 }).skip(skip).limit(limit).lean(),
        Order.countDocuments(filter),
    ]);
    const sellers = await sellersFor(docs);
    return buildPaginatedResult({
        docs: docs.map((o) => ({ ...baseRow(o, sellers), ndr: o.shipment?.ndr || null })),
        total,
        page,
        limit,
    });
}

/**
 * body: { action: 'reattempt' | 'rto' | 'contact', address1?, address2?, phone?,
 * deferredDate?, comments?, message? }
 */
export async function ndrActionAdmin(orderId, adminId, body = {}) {
    const action = String(body.action || '');
    if (!NDR_ACTIONS.includes(action)) throw new ValidationError(`action must be one of ${NDR_ACTIONS.join(', ')}`);
    const order = await loadCourierOrder(orderId);
    const s = order.shipment || {};
    if (!s.awb) throw new ValidationError('No active courier shipment for this order');
    if (!s.ndr?.attempts) throw new ValidationError('This shipment has no failed delivery attempt');
    if (String(s.status || '').startsWith('rto_')) throw new ValidationError('Shipment is already returning to origin');

    const now = new Date();
    const entry = { action, at: now, byId: adminId ? String(adminId) : '' };
    const set = {};

    if (action === 'contact') {
        const message = String(body.message || '').trim()
            || `We could not deliver order #${order.order_id || order._id}${s.ndr.lastReason ? ` (${s.ndr.lastReason})` : ''}. Please check your address and phone, or contact support.`;
        await notifyOwnerSafely(
            { ownerType: 'USER', ownerId: String(order.userId) },
            { title: 'Delivery attempt failed', body: message.slice(0, 500), data: { type: 'ndr', orderId: String(order._id), awb: String(s.awb) } },
        );
        entry.message = message.slice(0, 500);
        set['shipment.ndr.lastContactAt'] = now;
    } else {
        const params = { awb: s.awb, action };
        if (action === 'reattempt') {
            for (const k of ['address1', 'address2', 'phone', 'deferredDate', 'comments']) {
                if (body[k]) params[k] = String(body[k]).slice(0, 300);
            }
        } else if (body.comments) params.comments = String(body.comments).slice(0, 300);
        const result = await getShippingProvider().ndrAction(params);
        if (result && result.success === false) throw new ValidationError(result.message || 'Courier refused the NDR action');
        Object.assign(entry, params);
        delete entry.awb;
        set['shipment.ndr.action'] = action;
        set['shipment.ndr.actionAt'] = now;
        set['shipment.ndr.pending'] = false;
        if (action === 'rto') {
            set['shipment.status'] = 'rto_initiated';
            set['shipment.rto'] = { ...(s.rto || {}), initiatedAt: s.rto?.initiatedAt || now, receivedAt: null, via: 'ndr' };
        }
    }

    const updated = await Order.findOneAndUpdate(
        { _id: order._id, 'shipment.awb': s.awb },
        { $set: set, $push: { 'shipment.ndr.history': entry } },
        { new: true },
    ).lean();
    if (!updated) throw new ValidationError('Shipment changed; refresh and try again');
    return { orderId: updated.order_id || String(updated._id), shipment: updated.shipment };
}

// ---- RTO -------------------------------------------------------------------

/** `state`: open (default: on its way back) | received | all. */
export async function listRto(query = {}) {
    const { page, limit, skip } = buildPaginationOptions(query);
    const state = String(query.state || 'open');
    const filter = { fulfilmentMode: 'standard' };
    if (state === 'open') filter['shipment.status'] = { $in: RTO_STATUSES.filter((x) => x !== 'rto_received') };
    else if (state === 'received') filter['shipment.status'] = 'rto_received';
    else filter['shipment.status'] = { $in: RTO_STATUSES };
    const q = String(query.search || '').trim();
    if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ order_id: rx }, { 'shipment.awb': rx }];
    }
    const [docs, total] = await Promise.all([
        Order.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
        Order.countDocuments(filter),
    ]);
    const sellers = await sellersFor(docs);
    return buildPaginatedResult({
        docs: docs.map((o) => ({
            ...baseRow(o, sellers),
            rto: o.shipment?.rto || null,
            prepaid: String(o.payment?.method || 'cash') !== 'cash',
        })),
        total,
        page,
        limit,
    });
}

/**
 * The seller has the parcel back. Restocks once (claim on shipment.rto.receivedAt,
 * then the order's own stockRestoredAt guard) into the order's channel, cancels
 * the order, and refunds a prepaid order once (claim on rto.refundClaimedAt;
 * released on failure so a second call retries). Calling again after a success
 * changes nothing.
 */
export async function receiveRtoAdmin(orderId, adminId, { note = '' } = {}) {
    const order = await loadCourierOrder(orderId);
    const s = order.shipment || {};
    if (!RTO_STATUSES.includes(s.status)) throw new ValidationError('This shipment is not returning to origin');

    const now = new Date();
    const claimed = await Order.findOneAndUpdate(
        { _id: order._id, 'shipment.status': { $in: RTO_STATUSES.filter((x) => x !== 'rto_received') }, 'shipment.rto.receivedAt': { $in: [null] } },
        {
            $set: {
                'shipment.status': 'rto_received',
                'shipment.rto.receivedAt': now,
                'shipment.rto.receivedBy': adminId ? String(adminId) : '',
                'shipment.rto.note': String(note || '').slice(0, 300),
            },
        },
        { new: true },
    );

    let restocked = false;
    if (claimed) {
        try {
            if (claimed.stockReservedAt) {
                restocked = await restoreOrderStock(claimed);
            } else if (!claimed.stockRestoredAt) {
                const r = await Order.updateOne({ _id: claimed._id, stockRestoredAt: null }, { $set: { stockRestoredAt: now } });
                if (r.modifiedCount) {
                    await restockReturnedItems(claimed.items || [], channelForMode(claimed.fulfilmentMode));
                    restocked = true;
                }
            }
        } catch (err) {
            logger.error(`RTO restock failed for order ${claimed._id}: ${err?.message || err}`);
        }
        await Order.updateOne({ _id: claimed._id }, { $set: { 'shipment.rto.restocked': restocked } });

        if (!String(claimed.orderStatus).includes('cancel') && claimed.orderStatus !== 'delivered') {
            await Order.updateOne(
                { _id: claimed._id, orderStatus: claimed.orderStatus },
                {
                    $set: { orderStatus: 'cancelled_by_admin' },
                    $push: {
                        statusHistory: {
                            at: now, byRole: 'ADMIN', byId: adminId || undefined, from: claimed.orderStatus, to: 'cancelled_by_admin',
                            note: `Returned to origin (AWB ${s.awb || s.cancelledAwb || ''}) and received at seller`,
                        },
                    },
                },
            );
        }
    }

    const refund = await refundRtoOnce(order._id);
    const fresh = await Order.findById(order._id).lean();
    return {
        orderId: fresh.order_id || String(fresh._id),
        alreadyReceived: !claimed,
        restocked,
        refund,
        shipment: fresh.shipment,
        orderStatus: fresh.orderStatus,
        payment: fresh.payment,
    };
}

async function refundRtoOnce(orderMongoId) {
    const current = await Order.findById(orderMongoId).select('payment shipment').lean();
    const method = String(current?.payment?.method || 'cash').toLowerCase();
    if (method === 'cash' || method === 'cod') return { status: 'not_applicable', reason: 'cash_on_delivery' };
    if (current.shipment?.rto?.refund?.status === 'processed') return current.shipment.rto.refund;

    const claim = await Order.findOneAndUpdate(
        { _id: orderMongoId, 'shipment.rto.refundClaimedAt': { $in: [null] } },
        { $set: { 'shipment.rto.refundClaimedAt': new Date() } },
    );
    if (!claim) return current.shipment?.rto?.refund || { status: 'in_progress' };

    const order = await Order.findById(orderMongoId);
    let result;
    try {
        result = await applyCancellationRefund(order, {
            cancelledBy: 'admin',
            description: `Refund for order #${order.order_id || order._id} returned to origin`,
        });
    } catch (err) {
        result = { processed: false, reason: err?.message || 'refund_error' };
    }
    const processed = Boolean(result?.processed);
    const record = {
        status: processed ? 'processed' : 'failed',
        method: result?.method || method,
        refundId: result?.refundId || '',
        reason: processed ? (result?.reason || '') : result?.reason || 'refund_not_processed',
        amount: order.payment?.refund?.amount ?? order.pricing?.total ?? 0,
        at: new Date(),
    };
    order.shipment = { ...(order.shipment || {}), rto: { ...(order.shipment?.rto || {}), refund: record, refundClaimedAt: processed ? order.shipment?.rto?.refundClaimedAt || new Date() : null } };
    order.markModified('shipment');
    await order.save();
    return record;
}

// ---- COD remittance ---------------------------------------------------------

/** "awb,amount" CSV (header optional; columns found by name: awb / amount|cod|value). */
export function parseRemittanceCsv(text = '') {
    const rows = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')));
    if (!rows.length) return [];
    let awbCol = 0;
    let amtCol = 1;
    const head = rows[0].map((h) => h.toLowerCase());
    const hasHeader = head.some((h) => /awb|amount|cod|tracking/.test(h)) && !head.some((h) => /^\d+(\.\d+)?$/.test(h));
    if (hasHeader) {
        const a = head.findIndex((h) => /awb|tracking/.test(h));
        const m = head.findIndex((h) => /amount|cod|value|remit/.test(h) && !/awb/.test(h));
        if (a >= 0) awbCol = a;
        if (m >= 0) amtCol = m;
        rows.shift();
    }
    return rows
        .map((r) => ({ awb: String(r[awbCol] || '').trim(), amount: Number(String(r[amtCol] || '').replace(/[^\d.-]/g, '')) }))
        .filter((r) => r.awb);
}

function normalizeLines(input = {}) {
    const lines = Array.isArray(input.lines) && input.lines.length ? input.lines : parseRemittanceCsv(input.csv || '');
    const out = [];
    for (const l of lines) {
        const awb = String(l?.awb || '').trim();
        const amount = round2(l?.amount);
        if (!awb) continue;
        if (!Number.isFinite(amount) || amount < 0) throw new ValidationError(`Invalid amount for AWB ${awb}`);
        out.push({ awb, amount });
    }
    if (!out.length) throw new ValidationError('A remittance needs at least one AWB with an amount');
    return out;
}

const expectedCod = (o) => round2(o.payment?.amountDue ?? o.pricing?.total ?? 0);

/** Matches lines to delivered COD courier orders. Does not write. */
export async function matchRemittanceLines(lines, { excludeRemittanceId = null } = {}) {
    const awbs = [...new Set(lines.map((l) => l.awb))];
    const orders = await Order.find({ fulfilmentMode: 'standard', 'shipment.awb': { $in: awbs } })
        .select('order_id orderStatus payment pricing shipment')
        .lean();
    const byAwb = new Map(orders.map((o) => [String(o.shipment.awb), o]));
    const seen = new Set();
    const totals = { received: 0, expected: 0, matched: 0, short: 0, excess: 0, unexpected: 0, duplicate: 0 };

    const matched = lines.map((l) => {
        const o = byAwb.get(l.awb);
        const line = { awb: l.awb, amount: l.amount, orderId: o?._id || null, orderCode: o?.order_id || '', expected: null, status: 'unexpected', note: '' };
        totals.received = round2(totals.received + l.amount);
        if (seen.has(l.awb)) {
            line.status = 'duplicate';
            line.note = 'AWB listed twice in this remittance';
        } else if (!o) {
            line.note = 'No courier shipment with this AWB';
        } else if (String(o.payment?.method || '') !== 'cash') {
            line.note = 'Prepaid order: nothing to remit';
        } else if (o.orderStatus !== 'delivered' && o.shipment?.status !== 'delivered') {
            line.note = `Order is '${o.orderStatus}', not delivered`;
        } else {
            const already = o.shipment?.codRemittance;
            if (already?.remittanceId && String(already.remittanceId) !== String(excludeRemittanceId || '')) {
                line.status = 'duplicate';
                line.note = `Already remitted in ${already.reference || already.remittanceId}`;
            } else {
                line.expected = expectedCod(o);
                const diff = round2(l.amount - line.expected);
                line.status = Math.abs(diff) < 0.5 ? 'matched' : diff < 0 ? 'short' : 'excess';
                if (line.status !== 'matched') line.note = `${diff < 0 ? 'Short' : 'Excess'} by ${Math.abs(diff)}`;
                totals.expected = round2(totals.expected + line.expected);
            }
        }
        seen.add(l.awb);
        totals[line.status] = (totals[line.status] || 0) + 1;
        return line;
    });
    return { lines: matched, totals };
}

/**
 * Delivered COD courier shipments not yet covered by any remittance
 * ("missing" from the courier's payouts). `courier` narrows by courier name,
 * `before` to deliveries up to that date.
 */
export async function listCodOutstanding(query = {}) {
    const filter = {
        fulfilmentMode: 'standard',
        'payment.method': 'cash',
        orderStatus: 'delivered',
        'shipment.awb': { $nin: [null, ''] },
        'shipment.codRemittance.remittanceId': { $exists: false },
    };
    if (query.courier) filter['shipment.courierName'] = new RegExp(escapeRegex(query.courier), 'i');
    const before = query.before ? new Date(query.before) : null;
    if (before && !Number.isNaN(before.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.before))) before.setUTCHours(23, 59, 59, 999);
        filter['deliveryState.deliveredAt'] = { $lte: before };
    }
    const docs = await Order.find(filter).sort({ 'deliveryState.deliveredAt': 1 }).limit(Math.min(Number(query.limit) || 500, 2000)).lean();
    const rows = docs.map((o) => ({
        _id: String(o._id),
        orderId: o.order_id || String(o._id),
        awb: o.shipment.awb,
        courierName: o.shipment.courierName || '',
        deliveredAt: o.deliveryState?.deliveredAt || null,
        expected: expectedCod(o),
    }));
    return { count: rows.length, amount: round2(rows.reduce((s, r) => s + r.expected, 0)), rows };
}

export async function previewRemittance(body = {}) {
    const lines = normalizeLines(body);
    return matchRemittanceLines(lines);
}

export async function createRemittance(body = {}, adminId) {
    const courier = String(body.courier || '').trim();
    const reference = String(body.reference || body.utr || '').trim();
    const date = body.date ? new Date(body.date) : new Date();
    if (!courier) throw new ValidationError('courier is required');
    if (!reference) throw new ValidationError('UTR / reference is required');
    if (Number.isNaN(date.getTime())) throw new ValidationError('Invalid date');
    if (await CodRemittance.exists({ reference })) throw new ValidationError(`Remittance ${reference} is already recorded`);

    const { lines, totals } = await matchRemittanceLines(normalizeLines(body));
    let doc;
    try {
        doc = await CodRemittance.create({ courier, reference, date, note: String(body.note || '').slice(0, 500), lines, totals, createdBy: mongoose.isValidObjectId(adminId) ? adminId : null });
    } catch (err) {
        if (err?.code === 11000) throw new ValidationError(`Remittance ${reference} is already recorded`);
        throw err;
    }

    // Mark the orders' COD as remitted; a conditional update so a race with
    // another remittance cannot mark one order twice.
    for (const line of doc.lines) {
        if (!['matched', 'short', 'excess'].includes(line.status) || !line.orderId) continue;
        const res = await Order.updateOne(
            { _id: line.orderId, 'shipment.codRemittance.remittanceId': { $exists: false } },
            {
                $set: {
                    'shipment.codRemittance': {
                        remittanceId: doc._id, reference, courier, amount: line.amount, expected: line.expected,
                        status: line.status, remittedAt: date, recordedAt: new Date(),
                    },
                },
            },
        );
        if (!res.modifiedCount) {
            line.status = 'duplicate';
            line.note = 'Already remitted in another remittance';
        }
    }
    if (doc.isModified('lines')) {
        doc.totals = recount(doc.lines, doc.totals);
        await doc.save();
    }
    return getRemittance(doc._id);
}

function recount(lines, base = {}) {
    const t = { ...(base.toObject ? base.toObject() : base), matched: 0, short: 0, excess: 0, unexpected: 0, duplicate: 0 };
    for (const l of lines) t[l.status] = (t[l.status] || 0) + 1;
    return t;
}

export async function listRemittances(query = {}) {
    const { page, limit, skip } = buildPaginationOptions(query);
    const filter = {};
    if (query.courier) filter.courier = new RegExp(escapeRegex(query.courier), 'i');
    const q = String(query.search || '').trim();
    if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ reference: rx }, { 'lines.awb': rx }];
    }
    const [docs, total] = await Promise.all([
        CodRemittance.find(filter).select('-lines').sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        CodRemittance.countDocuments(filter),
    ]);
    return buildPaginatedResult({ docs, total, page, limit });
}

/** One remittance with its lines, plus shipments still missing for that courier up to its date. */
export async function getRemittance(id) {
    if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Remittance not found');
    const doc = await CodRemittance.findById(id).lean();
    if (!doc) throw new NotFoundError('Remittance not found');
    const missing = await listCodOutstanding({ courier: doc.courier, before: doc.date });
    return { ...doc, missing };
}

/**
 * COD collected and still owed: riders (Quick) from their wallets and deposits
 * (read-only; deposits have their own flow), couriers (Shop) from remittances.
 */
export async function getCodSummary() {
    const [riderCollected, riderWallets, riderDeposits, courierDelivered, courierRemitted] = await Promise.all([
        Order.aggregate([
            { $match: { fulfilmentMode: 'quick', 'payment.method': 'cash', orderStatus: 'delivered' } },
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$pricing.total', 0] } } } },
        ]),
        DeliveryWallet.aggregate([
            { $group: { _id: null, cashInHand: { $sum: '$cashInHand' }, riders: { $sum: { $cond: [{ $gt: ['$cashInHand', 0] }, 1, 0] } } } },
        ]),
        DeliveryCashDeposit.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
        Order.aggregate([
            { $match: { fulfilmentMode: 'standard', 'payment.method': 'cash', orderStatus: 'delivered' } },
            {
                $group: {
                    _id: { $ifNull: ['$shipment.courierName', 'Unknown'] },
                    count: { $sum: 1 },
                    amount: { $sum: { $ifNull: ['$payment.amountDue', { $ifNull: ['$pricing.total', 0] }] } },
                    remittedCount: { $sum: { $cond: [{ $ifNull: ['$shipment.codRemittance.remittanceId', false] }, 1, 0] } },
                    remittedAmount: { $sum: { $ifNull: ['$shipment.codRemittance.amount', 0] } },
                },
            },
        ]),
        CodRemittance.aggregate([{ $group: { _id: null, count: { $sum: 1 }, received: { $sum: '$totals.received' } } }]),
    ]);
    const deposits = Object.fromEntries(riderDeposits.map((d) => [String(d._id).toLowerCase(), { count: d.count, amount: round2(d.amount) }]));
    const couriers = courierDelivered.map((c) => ({
        courier: c._id,
        deliveredCount: c.count,
        deliveredAmount: round2(c.amount),
        remittedCount: c.remittedCount,
        remittedAmount: round2(c.remittedAmount),
        outstandingCount: c.count - c.remittedCount,
    }));
    const cSum = (k) => round2(couriers.reduce((s, c) => s + (Number(c[k]) || 0), 0));
    const outstanding = await listCodOutstanding({ limit: 2000 });
    return {
        riders: {
            collectedCount: riderCollected[0]?.count || 0,
            collectedAmount: round2(riderCollected[0]?.amount),
            cashInHand: round2(riderWallets[0]?.cashInHand),
            ridersHoldingCash: riderWallets[0]?.riders || 0,
            deposits: {
                completed: deposits.completed || { count: 0, amount: 0 },
                pending: deposits.pending || { count: 0, amount: 0 },
                failed: deposits.failed || { count: 0, amount: 0 },
            },
        },
        couriers: {
            deliveredAmount: cSum('deliveredAmount'),
            remittedAmount: cSum('remittedAmount'),
            outstandingCount: outstanding.count,
            outstandingAmount: outstanding.amount,
            remittances: courierRemitted[0]?.count || 0,
            byCourier: couriers,
        },
    };
}
