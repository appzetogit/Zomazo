import mongoose from 'mongoose';
import { Order } from '../models/order.model.js';
import { ReturnRequest, OPEN_RETURN_STATUSES } from '../models/returnRequest.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { BusinessSettings } from '../../admin/models/businessSettings.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { getShippingProvider } from '../../delivery/services/shipping/index.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { buildOrderIdentityFilter, notifyOwnerSafely } from './order.helpers.js';
import { applyCancellationRefund } from './order.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { restockReturnedItems } from './inventory.service.js';
import { channelForMode } from '../../shared/channels.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RETURN_WINDOW_DAYS = 7;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (v) => new mongoose.Types.ObjectId(String(v));

class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

// ---- settings --------------------------------------------------------------

export async function getReturnWindowDays() {
    const s = await BusinessSettings.findOne().select('returnWindowDays').lean();
    const days = Number(s?.returnWindowDays);
    return Number.isFinite(days) && days >= 0 ? days : DEFAULT_RETURN_WINDOW_DAYS;
}

export async function updateReturnSettings({ returnWindowDays } = {}) {
    const days = Number(returnWindowDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) {
        throw new ValidationError('returnWindowDays must be a whole number from 0 to 90');
    }
    await BusinessSettings.updateOne({}, { $set: { returnWindowDays: days } }, { upsert: true });
    return { returnWindowDays: days };
}

// ---- eligibility and amounts ----------------------------------------------

function deliveredAtOf(order) {
    const at = order.deliveryState?.deliveredAt;
    if (at) return new Date(at);
    const entry = [...(order.statusHistory || [])].reverse().find((h) => h.to === 'delivered');
    return entry?.at ? new Date(entry.at) : order.updatedAt ? new Date(order.updatedAt) : null;
}

const lineKey = (itemId, variantId) => `${itemId}::${variantId || ''}`;

/** Quantity per line already claimed by returns that were not rejected. */
async function claimedQuantities(orderId, excludeId = null) {
    const filter = { orderId, status: { $ne: 'rejected' } };
    if (excludeId) filter._id = { $ne: excludeId };
    const prior = await ReturnRequest.find(filter).select('items').lean();
    const claimed = new Map();
    for (const r of prior) {
        for (const i of r.items || []) {
            const k = lineKey(i.itemId, i.variantId);
            claimed.set(k, (claimed.get(k) || 0) + Number(i.quantity || 0));
        }
    }
    return claimed;
}

function returnableLines(order, claimed) {
    return (order.items || []).map((i) => {
        const k = lineKey(i.itemId, i.variantId);
        return {
            itemId: i.itemId,
            variantId: i.variantId || '',
            name: i.name,
            variantName: i.variantName || '',
            image: i.image || '',
            price: Number(i.price) || 0,
            ordered: Number(i.quantity) || 0,
            returnable: Math.max(0, (Number(i.quantity) || 0) - (claimed.get(k) || 0)),
        };
    });
}

/**
 * What returning `lines` gives back. The lines' share of the goods is their
 * share of the subtotal; the goods' paid value is the subtotal less the coupon
 * plus GST (fees are not refunded). Coins paid part of the whole order, so the
 * same fraction of this value comes back as coins and the rest as money.
 */
export function computeReturnAmounts(order, lines) {
    const p = order.pricing || {};
    const itemsTotal = (order.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    const subtotal = Number(p.subtotal) || itemsTotal;
    const itemsValue = round2(lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 0), 0));
    if (subtotal <= 0 || itemsValue <= 0) return { itemsValue, refundAmount: 0, coinsBack: 0 };

    const share = Math.min(1, itemsValue / subtotal);
    const goodsPaid = Math.max(0, subtotal - (Number(p.discount) || 0) + (Number(p.tax) || 0));
    const returnedValue = goodsPaid * share;

    const coinsDiscount = Number(order.coinsDiscount ?? p.coinsDiscount) || 0;
    const total = Number(p.total) || 0;
    const grossPaid = total + coinsDiscount;
    const coinFraction = grossPaid > 0 ? coinsDiscount / grossPaid : 0;
    const refundAmount = round2(Math.min(total, returnedValue * (1 - coinFraction)));
    const coinsBack = grossPaid > 0 ? Math.floor(((Number(order.coinsUsed) || 0) * returnedValue) / grossPaid) : 0;
    return { itemsValue, refundAmount, coinsBack };
}

async function loadUserOrder(userId, orderId) {
    const order = await Order.findOne({ ...buildOrderIdentityFilter(orderId), userId: oid(userId) });
    if (!order) throw new NotFoundError('Order not found');
    return order;
}

async function eligibility(order, now = new Date()) {
    const windowDays = await getReturnWindowDays();
    const deliveredAt = order.orderStatus === 'delivered' ? deliveredAtOf(order) : null;
    const windowEndsAt = deliveredAt ? new Date(deliveredAt.getTime() + windowDays * DAY_MS) : null;
    let reason = '';
    if (order.fulfilmentMode !== 'standard') reason = 'Only courier-shipped orders can be returned';
    else if (order.orderStatus !== 'delivered') reason = 'Only delivered orders can be returned';
    else if (!windowEndsAt || now > windowEndsAt) reason = `The ${windowDays}-day return window has closed`;
    return { eligible: !reason, reason, windowDays, deliveredAt, windowEndsAt };
}

// ---- customer --------------------------------------------------------------

export async function getOrderReturnsUser(userId, orderId) {
    const order = await loadUserOrder(userId, orderId);
    const [elig, claimed, returns] = await Promise.all([
        eligibility(order),
        claimedQuantities(order._id),
        ReturnRequest.find({ orderId: order._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const lines = returnableLines(order, claimed);
    const hasOpen = returns.some((r) => OPEN_RETURN_STATUSES.includes(r.status));
    const anyLeft = lines.some((l) => l.returnable > 0);
    return {
        ...elig,
        eligible: elig.eligible && !hasOpen && anyLeft,
        reason: elig.reason || (hasOpen ? 'A return for this order is already in progress' : !anyLeft ? 'Every item has already been returned' : ''),
        paymentMethod: order.payment?.method || '',
        items: lines,
        returns,
    };
}

export async function createReturnUser(userId, orderId, body = {}, now = new Date()) {
    const order = await loadUserOrder(userId, orderId);
    const elig = await eligibility(order, now);
    if (!elig.eligible) throw new ValidationError(elig.reason);

    const reason = String(body.reason || '').trim();
    if (!reason) throw new ValidationError('Tell us why you are returning these items');
    const refundTo = body.refundTo === 'coins' ? 'coins' : 'original';
    const photos = (Array.isArray(body.photos) ? body.photos : [])
        .map((p) => String(p || '').trim())
        .filter((p) => /^(https?:\/\/|\/(?!\/))/i.test(p))
        .slice(0, 5);

    const claimed = await claimedQuantities(order._id);
    const available = new Map(returnableLines(order, claimed).map((l) => [lineKey(l.itemId, l.variantId), l]));
    const wanted = new Map();
    for (const raw of Array.isArray(body.items) ? body.items : []) {
        const k = lineKey(String(raw?.itemId || ''), String(raw?.variantId || ''));
        const qty = Number(raw?.quantity);
        if (!Number.isInteger(qty) || qty <= 0) continue;
        wanted.set(k, (wanted.get(k) || 0) + qty);
    }
    if (!wanted.size) throw new ValidationError('Pick at least one item to return');

    const items = [];
    for (const [k, qty] of wanted) {
        const line = available.get(k);
        if (!line) throw new ValidationError('An item to return is not part of this order');
        if (qty > line.returnable) throw new ValidationError(`Only ${line.returnable} of "${line.name}" can be returned`);
        items.push({ itemId: line.itemId, variantId: line.variantId, name: line.name, image: line.image, price: line.price, quantity: qty });
    }

    const amounts = computeReturnAmounts(order, items);
    try {
        const doc = await ReturnRequest.create({
            orderId: order._id,
            orderReadableId: order.order_id || String(order._id),
            userId: order.userId,
            sellerId: order.sellerId,
            items,
            reason: reason.slice(0, 500),
            comment: String(body.comment || '').trim().slice(0, 1000),
            photos,
            refundTo,
            status: 'requested',
            openKey: String(order._id),
            amounts,
            history: [{ at: now, status: 'requested', byRole: 'USER', byId: String(userId) }],
        });
        return doc.toObject();
    } catch (err) {
        if (err?.code === 11000) throw new ConflictError('A return for this order is already in progress');
        throw err;
    }
}

// ---- lists -----------------------------------------------------------------

async function listReturns(filter, query) {
    const { page, limit, skip } = buildPaginationOptions(query);
    if (query.status) filter.status = String(query.status);
    const q = String(query.search || query.q || '').trim();
    if (q) filter.orderReadableId = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [docs, total] = await Promise.all([
        ReturnRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        ReturnRequest.countDocuments(filter),
    ]);
    return buildPaginatedResult({ docs, total, page, limit });
}

export async function listReturnsAdmin(query = {}) {
    const filter = {};
    if (query.sellerId && mongoose.isValidObjectId(query.sellerId)) filter.sellerId = oid(query.sellerId);
    const result = await listReturns(filter, query);
    const sellerIds = [...new Set(result.data.map((r) => String(r.sellerId)))];
    const sellers = new Map(
        (await Seller.find({ _id: { $in: sellerIds } }).select('sellerName').lean()).map((s) => [String(s._id), s.sellerName || ''])
    );
    result.data = result.data.map((r) => ({ ...r, sellerName: sellers.get(String(r.sellerId)) || '' }));
    return result;
}

export async function listReturnsSeller(sellerId, query = {}) {
    return listReturns({ sellerId: oid(sellerId) }, query);
}

export async function getReturnAdmin(id) {
    if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Return not found');
    const doc = await ReturnRequest.findById(id).lean();
    if (!doc) throw new NotFoundError('Return not found');
    const order = await Order.findById(doc.orderId)
        .select('order_id orderStatus customerName customerPhone deliveryAddress payment.method payment.status pricing coinsUsed coinsDiscount shipment items')
        .lean();
    const seller = await Seller.findById(doc.sellerId).select('sellerName').lean();
    return { ...doc, order, sellerName: seller?.sellerName || '' };
}

// ---- admin review ----------------------------------------------------------

function notifyCustomer(ret, title, body) {
    notifyOwnerSafely(
        { ownerType: 'USER', ownerId: String(ret.userId) },
        { title, body, data: { type: 'return_update', returnId: String(ret._id), orderId: String(ret.orderId), status: String(ret.status) } }
    ).catch(() => {});
}

const historyEntry = (status, adminId, note = '') => ({ at: new Date(), status, byRole: 'ADMIN', byId: String(adminId || ''), note });

/**
 * Approves a requested return. With `bookPickup` and a provider that supports
 * it, a reverse pickup is booked; a failed booking does not undo the approval
 * (the customer can still send it back) and is recorded on the return.
 */
export async function approveReturnAdmin(id, adminId, { bookPickup = false, note = '' } = {}) {
    const ret = await ReturnRequest.findOneAndUpdate(
        { _id: id, status: 'requested' },
        { $set: { status: 'approved', approvedAt: new Date() }, $push: { history: historyEntry('approved', adminId, note) } },
        { new: true }
    );
    if (!ret) {
        const exists = await ReturnRequest.exists({ _id: id });
        if (!exists) throw new NotFoundError('Return not found');
        throw new ConflictError('This return has already been reviewed');
    }

    if (bookPickup) {
        const provider = getShippingProvider();
        let reverseShipment;
        if (!provider.supportsReturns) {
            reverseShipment = { error: 'The shipping provider cannot book return pickups' };
        } else {
            try {
                const order = await Order.findById(ret.orderId).lean();
                const seller = await Seller.findById(ret.sellerId).select('sellerName phone ownerPhone addressLine1 city state pincode location').lean();
                const booked = await provider.createReturnShipment({
                    returnId: `RET-${String(ret._id).slice(-10).toUpperCase()}`,
                    orderId: order?.order_id || String(ret.orderId),
                    pickupAddress: order?.deliveryAddress || {},
                    customerName: order?.customerName,
                    customerPhone: order?.customerPhone,
                    sellerName: seller?.sellerName,
                    sellerPhone: seller?.phone || seller?.ownerPhone,
                    sellerPincode: seller?.pincode || seller?.location?.pincode || '',
                    sellerAddress: { addressLine1: seller?.addressLine1, city: seller?.city, state: seller?.state },
                    items: ret.items,
                    subTotal: ret.amounts?.itemsValue,
                    weightGrams: 500,
                });
                reverseShipment = { ...booked, bookedAt: new Date() };
            } catch (err) {
                logger.warn(`Return pickup booking for ${ret._id} failed: ${err?.message || err}`);
                reverseShipment = { error: String(err?.message || err) };
            }
        }
        ret.reverseShipment = reverseShipment;
        await ReturnRequest.updateOne({ _id: ret._id }, { $set: { reverseShipment } });
    }

    notifyCustomer(
        ret,
        'Return approved',
        ret.reverseShipment?.awb
            ? `Your return for order #${ret.orderReadableId} is approved. A courier will pick it up (AWB ${ret.reverseShipment.awb}).`
            : `Your return for order #${ret.orderReadableId} is approved.`
    );
    return ret.toObject();
}

export async function rejectReturnAdmin(id, adminId, reason = '') {
    const why = String(reason || '').trim();
    if (!why) throw new ValidationError('A reason is required to reject a return');
    const ret = await ReturnRequest.findOneAndUpdate(
        { _id: id, status: { $in: ['requested', 'approved'] } },
        {
            $set: { status: 'rejected', rejectionReason: why.slice(0, 500), rejectedAt: new Date() },
            $unset: { openKey: 1 },
            $push: { history: historyEntry('rejected', adminId, why) },
        },
        { new: true }
    );
    if (!ret) {
        const exists = await ReturnRequest.exists({ _id: id });
        if (!exists) throw new NotFoundError('Return not found');
        throw new ConflictError('This return can no longer be rejected');
    }
    notifyCustomer(ret, 'Return not accepted', `Your return for order #${ret.orderReadableId} was not accepted: ${why}`);
    return ret.toObject();
}

/**
 * Marks the items received and refunds, once. The return is claimed with a
 * conditional update (refund 'processing') before any money moves, so a second
 * or concurrent call gets a conflict instead of a second refund; a failed
 * refund leaves it 'received' with refund 'failed' and can be retried.
 */
export async function receiveAndRefundReturnAdmin(id, adminId, { note = '' } = {}) {
    const now = new Date();
    const ret = await ReturnRequest.findOneAndUpdate(
        { _id: id, status: { $in: ['approved', 'received'] }, 'refund.status': { $in: ['none', 'failed'] } },
        {
            $set: { status: 'received', receivedAt: now, 'refund.status': 'processing', 'refund.error': '' },
            $push: { history: historyEntry('received', adminId, note) },
        },
        { new: true }
    );
    if (!ret) {
        const current = await ReturnRequest.findById(id).select('status refund').lean();
        if (!current) throw new NotFoundError('Return not found');
        if (current.status === 'refunded' || current.refund?.status === 'processed') throw new ConflictError('This return has already been refunded');
        if (current.refund?.status === 'processing') throw new ConflictError('A refund for this return is already in progress');
        throw new ConflictError(`A return that is '${current.status}' cannot be refunded`);
    }

    // The units are back with the seller: return them to the order's channel, once.
    try {
        const claimed = await ReturnRequest.findOneAndUpdate(
            { _id: ret._id, restockedAt: null },
            { $set: { restockedAt: now } },
            { new: true, projection: { items: 1, orderId: 1 } },
        ).lean();
        if (claimed) {
            const order = await Order.findById(claimed.orderId).select('fulfilmentMode').lean();
            await restockReturnedItems(claimed.items, channelForMode(order?.fulfilmentMode));
        }
    } catch (err) {
        logger.error(`[CRITICAL] return restock failed for ${ret._id}: ${err?.message || err}`);
    }

    let outcome;
    try {
        outcome = await refundReturn(ret);
    } catch (err) {
        outcome = { processed: false, reason: String(err?.message || err) };
    }

    if (!outcome.processed) {
        const failed = await ReturnRequest.findOneAndUpdate(
            { _id: ret._id, 'refund.status': 'processing' },
            { $set: { 'refund.status': 'failed', 'refund.error': outcome.reason || 'Refund failed' } },
            { new: true }
        ).lean();
        const err = new ValidationError(`Refund failed: ${outcome.reason || 'unknown error'}`);
        err.data = failed;
        throw err;
    }

    const done = await ReturnRequest.findOneAndUpdate(
        { _id: ret._id, 'refund.status': 'processing' },
        {
            $set: {
                status: 'refunded',
                refundedAt: new Date(),
                refund: {
                    status: outcome.amount > 0 ? 'processed' : 'not_applicable',
                    method: outcome.method || '',
                    amount: outcome.amount || 0,
                    refundId: outcome.refundId || '',
                    error: '',
                    processedAt: new Date(),
                },
            },
            $unset: { openKey: 1 },
            $push: { history: historyEntry('refunded', adminId) },
        },
        { new: true }
    ).lean();

    if (outcome.amount > 0) {
        await Order.updateOne(
            { _id: ret.orderId },
            { $inc: { 'payment.refund.amount': outcome.amount }, $set: { 'payment.refund.status': 'processed', 'payment.refund.processedAt': new Date() } }
        );
    }

    notifyCustomer(
        done,
        'Refund processed',
        outcome.amount > 0
            ? `Rs ${outcome.amount} for your return on order #${done.orderReadableId} has been refunded${outcome.method === 'coins' ? ' as coins' : ''}.`
            : `Your return on order #${done.orderReadableId} is complete.`
    );
    return done;
}

/** Moves the money: the order's refund path, keyed by the return so it pays once. */
async function refundReturn(ret) {
    const order = await Order.findById(ret.orderId);
    if (!order) return { processed: false, reason: 'order_missing' };
    const amount = round2(ret.amounts?.refundAmount);
    const coinsBack = Number(ret.amounts?.coinsBack) || 0;
    const refKey = `return:${ret._id}`;
    const description = `Refund for returned items on order #${ret.orderReadableId}`;

    if (amount <= 0) {
        if (coinsBack > 0) {
            const { returnRedeemedCoins } = await import('../../coins/services/coin.service.js');
            await returnRedeemedCoins({ redemptionId: order.checkoutId || order._id, coins: coinsBack, refId: `${refKey}:coins`, note: description });
        }
        return { processed: true, amount: 0, method: coinsBack > 0 ? 'coins' : '' };
    }

    const result = await applyCancellationRefund(order, {
        cancelledBy: 'return',
        refundAmount: amount,
        refundTo: ret.refundTo === 'coins' ? 'coins' : undefined,
        partial: true,
        refKey,
        coinsToReturn: coinsBack,
        description,
    });
    if (result.processed) {
        return { processed: true, amount, method: result.method || order.payment?.method, refundId: result.refundId || '' };
    }

    // Cash on delivery has no payment to reverse: the money goes to the wallet.
    if (result.reason === 'cash_payment') {
        await userWalletService.refundWalletBalance(order.userId, amount, description, { orderId: refKey, cancelledBy: 'return' });
        return { processed: true, amount, method: 'wallet' };
    }
    return { processed: false, reason: result.reason || 'refund_not_processed' };
}
