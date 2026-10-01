import mongoose from 'mongoose';
import { PlatformOrder } from './platformOrder.model.js';
import { platformUserIdFor } from '../identity/platformUser.js';

/**
 * The common order record (platform_orders): mapping each service's record to
 * it, keeping it in step, and reading it.
 *
 * syncPlatformOrder(service, id) re-reads the service's own record from the
 * database and upserts its row -- so it is idempotent, and a write rolled back
 * in a transaction leaves the row as the committed record says (or absent).
 * A record that no longer exists has its row removed. Never throws.
 */

const coll = (name) => mongoose.connection.collection(name);
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const str = (v) => (v === undefined || v === null ? '' : String(v));

/* ------------------------------------------------------------ statuses */

function storeStatus(d) {
    const s = str(d.orderStatus);
    if (Number(d.payment?.refund?.amount) > 0 && d.payment?.refund?.status === 'processed' && String(s).startsWith('cancel')) return 'refunded';
    if (d.payment?.status === 'refunded') return 'refunded';
    if (s === 'delivered') return 'delivered';
    if (s.startsWith('cancelled') || s === 'rejected' || s === 'payment_failed') return 'cancelled';
    if (s === 'refunded') return 'refunded';
    if (['picked_up', 'reached_drop', 'out_for_delivery', 'shipped', 'in_transit'].includes(s)) return 'out_for_delivery';
    if (['preparing', 'ready_for_pickup', 'reached_pickup', 'packed', 'processing'].includes(s)) return 'preparing';
    if (s === 'confirmed' || s === 'accepted') return 'confirmed';
    return 'placed';
}
function rideStatus(d) {
    const s = str(d.status);
    const live = str(d.liveStatus);
    if (s === 'completed') return 'completed';
    if (s.startsWith('cancel') || s === 'expired' || s === 'no_driver_found') return 'cancelled';
    if (s === 'ongoing' || live === 'started') return 'on_trip';
    if (s === 'accepted') return 'confirmed';
    return 'placed';
}
function bookingStatus(d) {
    const s = str(d.status);
    if (d.paymentStatus === 'refunded') return 'refunded';
    if (s === 'completed') return 'completed';
    if (['cancelled', 'rejected', 'no_vendors', 'expired'].includes(s)) return 'cancelled';
    if (['journey_started', 'visited', 'in_progress', 'work_done'].includes(s)) return 'in_progress';
    if (['confirmed', 'accepted', 'assigned', 'awaiting_payment'].includes(s)) return 'confirmed';
    return 'placed';
}

const HIDDEN_STORE = new Set(['pending_payment', 'payment_failed']);

/* ------------------------------------------------------------- lookups */

async function nameOf(collection, id, fields) {
    if (!isId(id)) return {};
    const row = await coll(collection).findOne({ _id: oid(id) }, { projection: Object.fromEntries(fields.map((f) => [f, 1])) });
    return row || {};
}

async function customerOf(userId) {
    if (!isId(userId)) return { platformUserId: null, phone: '' };
    const resolved = await platformUserIdFor(userId).catch(() => null);
    const platformUserId = resolved?.platformId ? oid(resolved.platformId) : null;
    const account = platformUserId ? await coll('users').findOne({ _id: platformUserId }, { projection: { phone: 1 } }) : null;
    return { platformUserId, phone: str(account?.phone).replace(/\D/g, '').slice(-10) };
}

const itemsSummary = (items = []) => {
    const real = (items || []).filter((i) => !i?.isFreebie);
    if (!real.length) return '';
    const first = `${real[0].quantity || 1} × ${real[0].name || 'Item'}`;
    return real.length > 1 ? `${first}, +${real.length - 1} more` : first;
};

/* --------------------------------------------------------------- maps */

function storeAmounts(d) {
    const p = d.pricing || {};
    const total = num(p.total);
    const paidStatuses = new Set(['paid', 'captured', 'success', 'completed', 'refunded', 'partially_refunded']);
    const refunded = num(p.refund?.amount) || num(d.payment?.refund?.amount)
        || num((Number(d.adminRefund?.refundedPaise) || 0) / 100) || num((Number(d.returnRefundedPaise) || 0) / 100);
    return {
        subtotal: num(p.subtotal),
        discount: num(p.discount) + num(d.coinsDiscount),
        deliveryFee: num(p.deliveryFee),
        tax: num(p.tax),
        total,
        paid: paidStatuses.has(str(d.payment?.status)) || (d.payment?.method === 'cash' && d.orderStatus === 'delivered') ? total : 0,
        refunded,
    };
}

const storePayment = (d) => ({
    method: str(d.payment?.method),
    status: str(d.payment?.status),
    gatewayRef: str(d.payment?.razorpay?.paymentId || d.payment?.razorpay?.orderId || d.payment?.qr?.paymentLinkId),
});

function storeTimes(d, status) {
    const history = Array.isArray(d.statusHistory) ? d.statusHistory : [];
    const at = (pred) => history.slice().reverse().find((h) => pred(str(h.to || h.status)))?.at || null;
    return {
        completedAt: status === 'delivered' ? (d.deliveredAt || at((s) => s === 'delivered') || d.updatedAt || null) : null,
        cancelledAt: ['cancelled', 'refunded'].includes(status) ? (d.cancelledAt || at((s) => s.startsWith('cancel')) || d.updatedAt || null) : null,
    };
}

const SOURCES = {
    food: {
        collection: 'food_orders',
        async map(d) {
            const store = await nameOf('food_restaurants', d.restaurantId, ['restaurantName']);
            const status = storeStatus(d);
            return {
                partner: { type: 'restaurant', id: d.restaurantId || null, name: str(store.restaurantName) },
                number: str(d.order_id || (typeof d.orderId === 'string' ? d.orderId : '')),
                title: str(store.restaurantName) || 'Order',
                summary: itemsSummary(d.items),
                status, rawStatus: str(d.orderStatus), visible: !HIDDEN_STORE.has(d.orderStatus),
                amounts: storeAmounts(d), payment: storePayment(d),
                couponCode: str(d.pricing?.couponCode),
                route: `/food/user/orders/${d._id}`,
                ...storeTimes(d, status),
            };
        },
    },
    quickCommerce: {
        collection: 'qc_orders',
        async map(d) {
            const store = await nameOf('qc_restaurants', d.restaurantId, ['restaurantName', 'storeType']);
            const status = storeStatus(d);
            return {
                kind: String(store.storeType || '').toLowerCase() === 'pharmacy' ? 'medical' : '',
                partner: { type: 'store', id: d.restaurantId || null, name: str(store.restaurantName) },
                number: str(d.order_id || (typeof d.orderId === 'string' ? d.orderId : '')),
                title: str(store.restaurantName) || 'Order',
                summary: itemsSummary(d.items),
                status, rawStatus: str(d.orderStatus), visible: !HIDDEN_STORE.has(d.orderStatus),
                amounts: storeAmounts(d), payment: storePayment(d),
                couponCode: str(d.pricing?.couponCode),
                route: `/quick/orders/${d._id}`,
                ...storeTimes(d, status),
            };
        },
    },
    ecommerce: {
        collection: 'ecom_orders',
        async map(d) {
            const seller = await nameOf('ecom_sellers', d.sellerId, ['sellerName']);
            const status = storeStatus(d);
            return {
                partner: { type: 'seller', id: d.sellerId || null, name: str(seller.sellerName) },
                number: str(d.order_id || (typeof d.orderId === 'string' ? d.orderId : '')),
                title: str(seller.sellerName) || 'Order',
                summary: itemsSummary(d.items),
                status, rawStatus: str(d.orderStatus), visible: !HIDDEN_STORE.has(d.orderStatus) && !d.abandonedAt,
                amounts: storeAmounts(d), payment: storePayment(d),
                couponCode: str(d.pricing?.couponCode || d.couponClaim?.platformCode),
                route: `/shop/orders/${d._id}`,
                ...storeTimes(d, status),
            };
        },
    },
    taxi: {
        collection: 'taxirides',
        async map(d) {
            const driver = await nameOf('taxidrivers', d.driverId, ['name']);
            const status = rideStatus(d);
            const t = String(d.serviceType || '').toLowerCase();
            // serviceType says it; every ride carries an (empty) parcel block by default.
            const kind = t.includes('parcel') || t === 'delivery' || d.parcel?.category ? 'parcel' : t.includes('rental') ? 'rental' : '';
            const to = String(d.dropAddress || '').split(',')[0].trim();
            const fare = num(d.fare);
            const discount = num(d.promo?.discount_amount);
            const refunded = num((Number(d.adminRefund?.refundedPaise) || 0) / 100);
            const collected = str(d.driverPaymentCollection?.status) === 'paid' || status === 'completed';
            return {
                kind,
                partner: { type: 'driver', id: d.driverId || null, name: str(driver.name) },
                number: String(d._id).slice(-6).toUpperCase(),
                title: to ? `${kind === 'parcel' ? 'Parcel' : 'Ride'} to ${to}` : (kind === 'parcel' ? 'Parcel' : 'Ride'),
                summary: [d.pickupAddress, d.dropAddress].filter(Boolean).map((a) => String(a).split(',')[0].trim()).join(' → '),
                status: refunded > 0 && refunded >= fare && fare > 0 ? 'refunded' : status,
                rawStatus: str(d.status),
                visible: true,
                amounts: {
                    subtotal: num(d.promo?.fare_before_discount) || fare + discount,
                    discount,
                    deliveryFee: 0,
                    tax: 0,
                    total: fare,
                    paid: collected ? fare : 0,
                    refunded,
                },
                payment: {
                    method: str(d.paymentMethod),
                    status: str(d.driverPaymentCollection?.status || (status === 'completed' ? 'paid' : 'pending')),
                    gatewayRef: str(d.driverPaymentCollection?.providerPaymentId),
                },
                couponCode: str(d.promo?.code),
                route: `/taxi/user/ride/detail/${d._id}`,
                completedAt: status === 'completed' ? d.completedAt || d.updatedAt || null : null,
                cancelledAt: status === 'cancelled' ? d.cancellation_time || d.updatedAt || null : null,
            };
        },
    },
    serviceProvider: {
        collection: 'sp_bookings',
        async map(d) {
            const vendor = await nameOf('sp_vendors', d.vendorId, ['businessName', 'name']);
            const status = bookingStatus(d);
            const total = num(d.userPayableAmount ?? d.finalAmount);
            return {
                partner: { type: 'vendor', id: d.vendorId || null, name: str(vendor.businessName || vendor.name) },
                number: str(d.bookingNumber),
                title: str(d.serviceName || d.serviceCategory) || 'Booking',
                summary: d.scheduledDate ? new Date(d.scheduledDate).toISOString().slice(0, 10) : '',
                status, rawStatus: str(d.status), visible: true,
                amounts: {
                    subtotal: num(d.basePrice),
                    discount: num(d.discount) + num(d.promoDiscount),
                    deliveryFee: 0,
                    tax: num(d.tax),
                    total,
                    paid: num(d.paidAmount) || (['success', 'collected_by_vendor'].includes(str(d.paymentStatus)) ? total : 0),
                    refunded: num(d.refundedAmount),
                },
                payment: { method: str(d.paymentMethod), status: str(d.paymentStatus), gatewayRef: str(d.razorpayPaymentId || d.paymentId) },
                couponCode: str(d.couponCode || d.promoCode),
                route: `/services/bookings/${d._id}`,
                completedAt: status === 'completed' ? d.completedAt || null : null,
                cancelledAt: ['cancelled', 'refunded'].includes(status) ? d.cancelledAt || d.updatedAt || null : null,
            };
        },
    },
};

export const PLATFORM_ORDER_SOURCES = Object.freeze(Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.collection])));

/** The platform_orders row for one service record (no write). null for an unknown service. */
export async function buildPlatformOrder(service, doc) {
    const source = SOURCES[service];
    if (!source || !doc?._id) return null;
    const customer = await customerOf(doc.userId);
    const mapped = await source.map(doc);
    return {
        service,
        kind: '',
        sourceCollection: source.collection,
        sourceId: doc._id,
        platformUserId: customer.platformUserId,
        customerPhone: customer.phone,
        ...mapped,
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || null,
        syncedAt: new Date(),
    };
}

/**
 * Bring one record's row in step with the record as the database holds it.
 * @returns {Promise<'upserted'|'removed'|'skipped'>}
 */
export async function syncPlatformOrder(service, idOrDoc) {
    try {
        const source = SOURCES[service];
        const id = idOrDoc?._id || idOrDoc;
        if (!source || !isId(id)) return 'skipped';
        const doc = await coll(source.collection).findOne({ _id: oid(id) });
        if (!doc) {
            await PlatformOrder.collection.deleteOne({ service, sourceId: oid(id) });
            return 'removed';
        }
        const row = await buildPlatformOrder(service, doc);
        await PlatformOrder.collection.updateOne({ service, sourceId: row.sourceId }, { $set: row }, { upsert: true });
        return 'upserted';
    } catch (err) {
        console.warn(`[platformOrders] ${service} ${String(idOrDoc?._id || idOrDoc)} not synced: ${err.message}`);
        return 'skipped';
    }
}

/* -------------------------------------------------------------- reads */

/** Written by the backfill when every service has been copied: readers may rely on platform_orders. */
export const BACKFILL_MARKER = { collection: 'platform_orders_meta', _id: 'backfilled' };

let backfilledCache = { at: 0, done: false };
export async function isBackfilled() {
    if (backfilledCache.done || Date.now() - backfilledCache.at < 60 * 1000) return backfilledCache.done;
    const hit = await coll(BACKFILL_MARKER.collection).findOne({ _id: BACKFILL_MARKER._id });
    backfilledCache = { at: Date.now(), done: Boolean(hit) };
    return backfilledCache.done;
}
export const clearBackfilledCache = () => { backfilledCache = { at: 0, done: false }; };

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Master > All orders: every service's orders, newest first.
 * @param {object} q { service?, status?, from?, to?, phone?, partner? (id or name), q? (number), before?, limit? }
 */
export async function listPlatformOrders(q = {}) {
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const filter = { visible: true };
    if (Array.isArray(q.services)) filter.service = { $in: q.services.filter((s) => SOURCES[s]) };
    if (q.service && SOURCES[q.service]) filter.service = Array.isArray(q.services) && !q.services.includes(q.service) ? '__none__' : q.service;
    if (q.status) filter.status = String(q.status);
    const createdAt = {};
    if (q.from && !Number.isNaN(Date.parse(q.from))) createdAt.$gte = new Date(`${String(q.from).slice(0, 10)}T00:00:00`);
    if (q.to && !Number.isNaN(Date.parse(q.to))) createdAt.$lte = new Date(`${String(q.to).slice(0, 10)}T23:59:59.999`);
    if (q.before && !Number.isNaN(Date.parse(q.before))) createdAt.$lt = new Date(q.before);
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;
    const phone = String(q.phone || '').replace(/\D/g, '').slice(-10);
    if (phone) filter.customerPhone = phone.length === 10 ? phone : new RegExp(escape(phone));
    if (q.partner) filter.$or = isId(q.partner) ? [{ 'partner.id': oid(q.partner) }] : [{ 'partner.name': new RegExp(escape(q.partner), 'i') }];
    if (q.q) filter.number = new RegExp(escape(String(q.q).slice(0, 40)), 'i');
    const items = await PlatformOrder.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const page = items.slice(0, limit);
    return {
        items: page,
        nextBefore: items.length > limit ? new Date(page[page.length - 1].createdAt).toISOString() : null,
        backfilled: await isBackfilled(),
    };
}
