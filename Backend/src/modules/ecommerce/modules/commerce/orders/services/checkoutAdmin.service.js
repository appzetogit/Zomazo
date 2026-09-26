/**
 * Admin view of split checkouts (order groups): one customer payment that was
 * split into one child order per seller.
 */
import mongoose from 'mongoose';
import { Checkout } from '../models/checkout.model.js';
import { Order } from '../models/order.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { User } from '../../../../core/users/user.model.js';
import { DeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseDay(v, endOfDay) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) d.setUTCHours(23, 59, 59, 999);
    return d;
}

const customerOf = (ck, user) => ({
    _id: ck.userId ? String(ck.userId) : '',
    name: user?.name || ck.customerAddress?.fullName || ck.customerAddress?.name || '',
    phone: user?.phone || ck.customerAddress?.phone || '',
});

/** query: search (checkoutId / customer name / phone), status, mode, from, to, page, limit */
export async function listCheckoutsAdmin(query = {}) {
    const { page, limit, skip } = buildPaginationOptions(query);
    const filter = {};
    if (query.status) filter.status = String(query.status);
    if (query.mode) filter.fulfilmentMode = String(query.mode) === 'shop' ? 'standard' : String(query.mode);
    const from = parseDay(query.from, false);
    const to = parseDay(query.to, true);
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = from;
        if (to) filter.createdAt.$lte = to;
    }
    const q = String(query.search || query.q || '').trim();
    if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        const users = await User.find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').limit(200).lean();
        filter.$or = [
            { checkoutId: rx },
            { childOrderCodes: rx },
            { 'customerAddress.phone': rx },
            { 'customerAddress.name': rx },
            { 'customerAddress.fullName': rx },
            ...(users.length ? [{ userId: { $in: users.map((u) => u._id) } }] : []),
        ];
    }

    const [docs, total] = await Promise.all([
        Checkout.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Checkout.countDocuments(filter),
    ]);
    const userIds = [...new Set(docs.map((d) => String(d.userId)).filter(Boolean))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('name phone').lean() : [];
    const byUser = new Map(users.map((u) => [String(u._id), u]));

    const rows = docs.map((ck) => ({
        _id: String(ck._id),
        checkoutId: ck.checkoutId,
        createdAt: ck.createdAt,
        status: ck.status,
        mode: ck.fulfilmentMode === 'standard' ? 'shop' : 'quick',
        customer: customerOf(ck, byUser.get(String(ck.userId))),
        orderCount: (ck.childOrderIds || []).length,
        sellerCount: (ck.sellerIds || []).length,
        grandTotal: ck.pricing?.grandTotal ?? 0,
        payment: { method: ck.payment?.method || '', status: ck.payment?.status || '' },
        couponCode: ck.pricing?.couponCode || ck.appliedCoupon?.code || null,
        coinsUsed: ck.pricing?.coinsUsed || 0,
    }));
    return buildPaginatedResult({ docs: rows, total, page, limit });
}

/** One checkout by its code (CK...) or _id, with each child order. */
export async function getCheckoutAdmin(id) {
    const key = String(id || '').trim();
    const ck = await Checkout.findOne(mongoose.isValidObjectId(key) ? { _id: key } : { checkoutId: key }).lean();
    if (!ck) throw new NotFoundError('Checkout not found');

    const orders = await Order.find({ $or: [{ checkoutId: ck._id }, { _id: { $in: ck.childOrderIds || [] } }] })
        .sort({ createdAt: 1 })
        .lean();
    const sellerIds = [...new Set(orders.map((o) => String(o.sellerId)).filter(Boolean))];
    const riderIds = [...new Set(orders.map((o) => String(o.dispatch?.deliveryPartnerId || '')).filter(Boolean))];
    const [sellers, riders, user] = await Promise.all([
        sellerIds.length ? Seller.find({ _id: { $in: sellerIds } }).select('sellerName shopName phone').lean() : [],
        riderIds.length ? DeliveryPartner.find({ _id: { $in: riderIds } }).select('name phone').lean() : [],
        ck.userId ? User.findById(ck.userId).select('name phone email').lean() : null,
    ]);
    const sellerMap = new Map(sellers.map((s) => [String(s._id), s]));
    const riderMap = new Map(riders.map((r) => [String(r._id), r]));

    const children = orders.map((o) => {
        const seller = sellerMap.get(String(o.sellerId));
        const rider = riderMap.get(String(o.dispatch?.deliveryPartnerId || ''));
        const s = o.shipment || null;
        return {
            _id: String(o._id),
            orderId: o.order_id || String(o._id),
            status: o.orderStatus,
            mode: o.fulfilmentMode === 'standard' ? 'shop' : 'quick',
            seller: seller ? { _id: String(seller._id), name: seller.sellerName || seller.shopName || '', phone: seller.phone || '' } : null,
            itemCount: (o.items || []).reduce((n, i) => n + (Number(i.quantity) || 0), 0),
            items: (o.items || []).map((i) => ({ itemId: i.itemId, name: i.name, quantity: i.quantity, price: i.price })),
            pricing: {
                subtotal: o.pricing?.subtotal ?? 0,
                deliveryFee: o.pricing?.deliveryFee ?? 0,
                platformFee: o.pricing?.platformFee ?? 0,
                tax: o.pricing?.tax ?? 0,
                couponShare: o.pricing?.discount ?? 0,
                coinsUsed: o.coinsUsed || 0,
                coinsShare: o.coinsDiscount || 0,
                total: o.pricing?.total ?? 0,
            },
            payment: { method: o.payment?.method || '', status: o.payment?.status || '', refund: o.payment?.refund || null },
            shipment: s ? { awb: s.awb || null, courierName: s.courierName || '', status: s.status || '', ndr: s.ndr || null, rto: s.rto || null } : null,
            rider: rider ? { _id: String(rider._id), name: rider.name || '', phone: rider.phone || '' } : null,
            createdAt: o.createdAt,
        };
    });
    const sum = (f) => round2(children.reduce((n, c) => n + (Number(f(c)) || 0), 0));

    return {
        _id: String(ck._id),
        checkoutId: ck.checkoutId,
        createdAt: ck.createdAt,
        status: ck.status,
        mode: ck.fulfilmentMode === 'standard' ? 'shop' : 'quick',
        customer: { ...customerOf(ck, user), email: user?.email || '' },
        address: ck.customerAddress || null,
        payment: ck.payment,
        pricing: ck.pricing,
        coupon: ck.appliedCoupon || (ck.pricing?.couponCode ? { code: ck.pricing.couponCode } : null),
        split: {
            orders: children.length,
            subtotal: sum((c) => c.pricing.subtotal),
            couponShares: sum((c) => c.pricing.couponShare),
            coinsShares: sum((c) => c.pricing.coinsShare),
            deliveryFees: sum((c) => c.pricing.deliveryFee),
            total: sum((c) => c.pricing.total),
        },
        orders: children,
    };
}
