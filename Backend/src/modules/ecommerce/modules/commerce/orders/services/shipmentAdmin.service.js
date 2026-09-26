import mongoose from 'mongoose';
import { Order } from '../models/order.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { getShippingProvider } from '../../delivery/services/shipping/index.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import {
    buildOrderIdentityFilter,
    canExposeOrderToSeller,
    isStatusAdvance,
    normalizeOrderForClient,
} from './order.helpers.js';
import { bookOrderShipment, markOrderDeliveredAdmin } from './order.service.js';
import { captureTrackingEvents } from './courierOps.service.js';

/** Order statuses a courier shipment can be booked from. */
const BOOKABLE_STATUSES = ['created', 'confirmed', 'preparing', 'ready_for_pickup'];
/** Courier statuses after which a shipment can no longer be cancelled. */
const UNCANCELLABLE = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'undelivered', 'rto_initiated', 'rto_in_transit', 'rto_delivered', 'rto_received'];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function loadStandardOrder(orderId) {
    const order = await Order.findOne({ ...buildOrderIdentityFilter(orderId), fulfilmentMode: 'standard' });
    if (!order) throw new NotFoundError('Courier order not found');
    return order;
}

function shipmentRow(o, sellers) {
    const s = o.shipment || null;
    const seller = sellers.get(String(o.sellerId)) || null;
    return {
        _id: String(o._id),
        orderId: o.order_id || String(o._id),
        orderStatus: o.orderStatus,
        createdAt: o.createdAt,
        total: o.pricing?.total ?? 0,
        paymentMethod: o.payment?.method || '',
        seller: seller ? { _id: String(seller._id), name: seller.sellerName || seller.shopName || '' } : null,
        customer: { name: o.customerName || o.deliveryAddress?.fullName || o.deliveryAddress?.name || '', phone: o.customerPhone || '' },
        destination: { city: o.deliveryAddress?.city || '', pincode: o.deliveryAddress?.zipCode || '' },
        shipment: s,
        shipmentStatus: !s ? 'not_booked' : s.status || (s.awb ? 'manifested' : 'not_booked'),
        canBook: !s?.awb && BOOKABLE_STATUSES.includes(o.orderStatus) && canExposeOrderToSeller(o),
        canCancel: Boolean(s?.awb) && o.orderStatus !== 'delivered' && !UNCANCELLABLE.includes(s.status),
    };
}

/**
 * Standard (courier) orders with their shipment. `status` filters on the
 * shipment: 'not_booked', 'cancelled', or a courier status last seen by tracking
 * ('manifested', 'in_transit', 'delivered', ...).
 */
export async function listShipments(query = {}) {
    const { page, limit, skip } = buildPaginationOptions(query);
    const filter = { fulfilmentMode: 'standard', orderStatus: { $ne: 'pending_payment' } };
    const and = [];

    const status = String(query.status || '').trim();
    if (status === 'not_booked') {
        and.push({ $or: [{ shipment: null }, { 'shipment.awb': { $in: [null, ''] }, 'shipment.status': { $ne: 'cancelled' } }] });
    } else if (status === 'booked') {
        and.push({ 'shipment.awb': { $nin: [null, ''] } });
    } else if (status === 'manifested') {
        and.push({ 'shipment.awb': { $nin: [null, ''] } }, { 'shipment.status': { $in: [null, 'manifested'] } });
    } else if (status) {
        and.push({ 'shipment.status': status });
    }
    if (query.courier) and.push({ 'shipment.courierName': new RegExp(escapeRegex(query.courier), 'i') });
    if (query.sellerId && mongoose.isValidObjectId(query.sellerId)) filter.sellerId = new mongoose.Types.ObjectId(String(query.sellerId));

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
        filter.createdAt = {};
        if (from && !Number.isNaN(from.getTime())) filter.createdAt.$gte = from;
        if (to && !Number.isNaN(to.getTime())) {
            // A bare date means the whole of that day.
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to))) to.setUTCHours(23, 59, 59, 999);
            filter.createdAt.$lte = to;
        }
    }

    const q = String(query.search || query.q || '').trim();
    if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        and.push({ $or: [{ order_id: rx }, { 'shipment.awb': rx }, { 'shipment.cancelledAwb': rx }] });
    }
    if (and.length) filter.$and = and;

    const [docs, total] = await Promise.all([
        Order.find(filter)
            .select('order_id orderStatus createdAt pricing.total payment.method payment.status sellerId customerName customerPhone deliveryAddress shipment')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Order.countDocuments(filter),
    ]);
    const sellerIds = [...new Set(docs.map((d) => String(d.sellerId)).filter(Boolean))];
    const sellerDocs = sellerIds.length
        ? await Seller.find({ _id: { $in: sellerIds } }).select('sellerName shopName').lean()
        : [];
    const sellers = new Map(sellerDocs.map((s) => [String(s._id), s]));
    return buildPaginatedResult({ docs: docs.map((d) => shipmentRow(d, sellers)), total, page, limit });
}

/**
 * Live tracking from the provider. The courier status is kept on the order; a
 * 'delivered' reading also delivers the order when its status can still move
 * there (the same admin path as "mark delivered"), otherwise it is only shown.
 */
export async function trackShipmentAdmin(orderId, adminId) {
    const order = await loadStandardOrder(orderId);
    const awb = order.shipment?.awb;
    if (!awb) throw new ValidationError('No courier shipment booked for this order');

    const tracking = await getShippingProvider().trackShipment(awb);
    const currentStatus = String(tracking?.currentStatus || '').toLowerCase();
    const now = new Date();
    if (currentStatus) {
        // An RTO the seller already received stays received whatever the courier says.
        await Order.updateOne(
            { _id: order._id, 'shipment.awb': awb, 'shipment.status': { $ne: 'rto_received' } },
            { $set: { 'shipment.status': currentStatus, 'shipment.lastTrackedAt': now } }
        );
    }
    // NDR (failed attempt) details and the start of an RTO leg.
    try {
        await captureTrackingEvents(order._id, awb, tracking);
    } catch (err) {
        logger.warn(`NDR/RTO capture for ${order._id} failed: ${err?.message || err}`);
    }

    let orderDelivered = false;
    if (currentStatus === 'delivered' && isStatusAdvance(order.orderStatus, 'delivered') && !String(order.orderStatus).includes('cancel')) {
        try {
            await markOrderDeliveredAdmin(String(order._id), adminId, `Courier tracking reports delivered (AWB ${awb})`);
            orderDelivered = true;
        } catch (err) {
            logger.warn(`Tracking-based delivery of ${order._id} skipped: ${err?.message || err}`);
        }
    }

    const fresh = await Order.findById(order._id).select('orderStatus shipment').lean();
    return {
        orderId: order.order_id || String(order._id),
        awb,
        orderStatus: fresh?.orderStatus || order.orderStatus,
        shipment: fresh?.shipment || order.shipment,
        tracking,
        orderDelivered,
    };
}

// Courier states after which there is nothing more to learn from tracking.
const TRACKING_DONE = ['delivered', 'cancelled', 'canceled', 'rto_delivered', 'rto_received', 'returned'];

/**
 * Refreshes tracking for active courier shipments not checked recently, so
 * delivery, NDR and RTO updates arrive without anyone opening the order.
 * Oldest-checked first, a bounded batch per run; one failing shipment never
 * stops the rest.
 */
export async function syncActiveShipmentTracking({ limit = 100, staleMinutes = 25, now = new Date() } = {}) {
    const staleBefore = new Date(now.getTime() - staleMinutes * 60_000);
    const due = await Order.find({
        fulfilmentMode: 'standard',
        'shipment.awb': { $exists: true, $nin: [null, ''] },
        'shipment.status': { $nin: TRACKING_DONE },
        orderStatus: { $nin: ['cancelled_by_user', 'cancelled_by_seller', 'cancelled_by_admin'] },
        $or: [{ 'shipment.lastTrackedAt': null }, { 'shipment.lastTrackedAt': { $lt: staleBefore } }],
    })
        .sort({ 'shipment.lastTrackedAt': 1, createdAt: 1 })
        .limit(Math.max(1, Math.min(Number(limit) || 100, 500)))
        .select('_id')
        .lean();

    let tracked = 0;
    let delivered = 0;
    let failed = 0;
    for (const { _id } of due) {
        try {
            const res = await trackShipmentAdmin(String(_id), null);
            tracked++;
            if (res.orderDelivered) delivered++;
        } catch (err) {
            failed++;
            logger.warn(`Tracking sync for order ${_id} failed: ${err?.message || err}`);
            // Don't retry a broken shipment every run: back off until the next window.
            await Order.updateOne({ _id }, { $set: { 'shipment.lastTrackedAt': now } }).catch(() => {});
        }
    }
    return { due: due.length, tracked, delivered, failed };
}

/** Books the courier on the seller's behalf (same path the seller uses). */
export async function bookShipmentAdmin(orderId, adminId) {
    const order = await loadStandardOrder(orderId);
    if (order.shipment?.awb) throw new ValidationError('A shipment is already booked for this order');
    if (!BOOKABLE_STATUSES.includes(order.orderStatus) || !canExposeOrderToSeller(order)) {
        throw new ValidationError(`A shipment cannot be booked for an order that is '${order.orderStatus}'`);
    }
    return bookOrderShipment(order, { byRole: 'ADMIN', byId: adminId });
}

/**
 * Cancels the booked shipment with the courier. The order stays where it is so
 * the shipment can be booked again; the cancelled AWB is kept for reference.
 */
export async function cancelShipmentAdmin(orderId, adminId, reason = '') {
    const order = await loadStandardOrder(orderId);
    const s = order.shipment || {};
    if (!s.awb) throw new ValidationError('No active courier shipment to cancel');
    if (order.orderStatus === 'delivered' || UNCANCELLABLE.includes(s.status)) {
        throw new ValidationError(`Shipment is already ${s.status || order.orderStatus} and cannot be cancelled`);
    }

    const provider = getShippingProvider();
    const result = await provider.cancelShipment(s.providerOrderId || s.shipmentId);
    if (result && result.success === false) {
        throw new ValidationError(result.message || 'Courier refused the cancellation');
    }

    const now = new Date();
    const updated = await Order.findOneAndUpdate(
        { _id: order._id, 'shipment.awb': s.awb },
        {
            $set: {
                'shipment.status': 'cancelled',
                'shipment.cancelledAt': now,
                'shipment.cancelledAwb': s.awb,
                'shipment.cancelReason': String(reason || '').slice(0, 300),
                'shipment.awb': null,
            },
            $push: {
                statusHistory: {
                    at: now,
                    byRole: 'ADMIN',
                    byId: adminId || undefined,
                    from: order.orderStatus,
                    to: order.orderStatus,
                    note: `Courier shipment cancelled (AWB ${s.awb})${reason ? `: ${reason}` : ''}`,
                },
            },
        },
        { new: true }
    );
    if (!updated) throw new ValidationError('Shipment changed while cancelling; refresh and try again');
    return { order: normalizeOrderForClient(updated), shipment: updated.shipment };
}
