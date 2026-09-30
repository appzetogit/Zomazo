/**
 * Master > Coupons: making and editing platform coupons (platformCoupon.model.js).
 *
 * Who may: a platform owner, or an admin with the `promotions` permission in
 * EVERY service the coupon names -- a Food-only offers admin cannot make a
 * coupon the Shop will honour, and cannot edit one that the Shop honours.
 * (A module superadmin passes decideAdminAccess for any service, so the
 * services an admin was given are checked here as well.)
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess, effectiveAdminLevel, effectiveServices, servicesForApi } from '../admin/adminAccessPolicy.js';
import { PlatformCoupon, PLATFORM_COUPON_SERVICES } from './platformCoupon.model.js';

export const PLATFORM_SERVICE_LABELS = Object.freeze({
    food: 'Food',
    quickCommerce: 'Quick & Medical',
    ecommerce: 'Shop',
    taxi: 'Rides',
    serviceProvider: 'Services',
});

const isOwner = (admin) => effectiveAdminLevel(admin) === 'platform_superadmin';

const mayUse = (admin, service, write) => {
    if (isOwner(admin)) return true;
    const given = effectiveServices(admin);
    if (!servicesForApi(service).some((s) => given.includes(s))) return false;
    return decideAdminAccess(admin, { service, resource: 'promotions', write }).allowed;
};

/** Every named service for a change; any one for a look. */
export const canManagePlatformCoupon = (admin, services = [], write = true) => {
    if (!admin || !services.length) return isOwner(admin);
    return write
        ? services.every((s) => mayUse(admin, s, true))
        : services.some((s) => mayUse(admin, s, false));
};

/** Whether this admin may see platform coupons at all. */
export const canSeePlatformCoupons = (admin) =>
    isOwner(admin) || PLATFORM_COUPON_SERVICES.some((s) => mayUse(admin, s, false));

const num = (v, name, { min = 0, max = Infinity } = {}) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, `${name} must be a number from ${min}${Number.isFinite(max) ? ` to ${max}` : ''}`);
    return n;
};
const when = (v, name) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `${name} is not a date`);
    return d;
};

/** The fields a request may set, checked and normalised. */
function readBody(body = {}, { creating }) {
    const out = {};
    if (creating || body.code !== undefined) {
        const code = String(body.code || '').trim().toUpperCase();
        if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new ApiError(400, 'Code must be 3-20 letters, digits, - or _');
        out.code = code;
    }
    if (body.title !== undefined) out.title = String(body.title || '').trim().slice(0, 80);
    if (body.description !== undefined) out.description = String(body.description || '').trim().slice(0, 300);
    if (creating || body.services !== undefined) {
        const services = [...new Set((Array.isArray(body.services) ? body.services : []).map(String))];
        if (!services.length) throw new ApiError(400, 'Pick at least one service');
        const unknown = services.filter((s) => !PLATFORM_COUPON_SERVICES.includes(s));
        if (unknown.length) throw new ApiError(400, `Unknown service: ${unknown.join(', ')}`);
        out.services = services;
    }
    if (creating || body.discountType !== undefined) {
        if (!['percentage', 'flat'].includes(body.discountType)) throw new ApiError(400, 'Discount type must be percentage or flat');
        out.discountType = body.discountType;
    }
    const pct = (out.discountType || body.discountType) === 'percentage';
    const value = num(body.discountValue, 'Discount', { min: 0, max: pct ? 100 : 100000 });
    if (creating && !(value > 0)) throw new ApiError(400, 'Discount must be more than 0');
    if (value !== undefined) out.discountValue = value;
    for (const [key, label] of [['maxDiscount', 'Maximum discount'], ['minOrderValue', 'Minimum order'], ['usageLimit', 'Total uses'], ['perUserLimit', 'Uses per customer']]) {
        const v = num(body[key], label, { min: 0, max: 10000000 });
        if (v !== undefined) out[key] = v;
    }
    if (body.audience !== undefined) {
        if (!['all', 'first_order'].includes(body.audience)) throw new ApiError(400, 'Audience must be all or first_order');
        out.audience = body.audience;
    }
    const start = when(body.startDate, 'Start date');
    const end = when(body.endDate, 'End date');
    if (start !== undefined) out.startDate = start;
    if (end !== undefined) out.endDate = end;
    if (out.startDate && out.endDate && out.endDate <= out.startDate) throw new ApiError(400, 'End date must be after the start date');
    if (body.status !== undefined) {
        if (!['active', 'paused'].includes(body.status)) throw new ApiError(400, 'Status must be active or paused');
        out.status = body.status;
    }
    return out;
}

/** Duplicate-code refusals (ours or the registry's) as a 409 the screen can show. */
const asConflict = (err) => {
    if (err?.code === 11000) {
        return new ApiError(409, err.statusCode === 409 ? err.message : 'A coupon with this code already exists');
    }
    return err;
};

export async function createPlatformCoupon(admin, body) {
    const fields = readBody(body, { creating: true });
    if (!canManagePlatformCoupon(admin, fields.services, true)) {
        throw new ApiError(403, 'You need offers access in every service this coupon is for');
    }
    try {
        const doc = await PlatformCoupon.create({ ...fields, createdBy: admin?._id || null });
        return doc.toObject();
    } catch (err) {
        throw asConflict(err);
    }
}

export async function updatePlatformCoupon(admin, id, body) {
    if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw new ApiError(404, 'Coupon not found');
    const current = await PlatformCoupon.findById(id).lean();
    if (!current) throw new ApiError(404, 'Coupon not found');
    const fields = readBody(body, { creating: false });
    const touched = [...new Set([...(current.services || []), ...(fields.services || [])])];
    if (!canManagePlatformCoupon(admin, touched, true)) {
        throw new ApiError(403, 'You need offers access in every service this coupon is for');
    }
    // A code customers have already used stays what they used.
    if (fields.code && fields.code !== current.code && Number(current.usedCount) > 0) {
        throw new ApiError(400, 'This coupon has been used, so its code cannot change. Make a new coupon instead.');
    }
    try {
        const doc = await PlatformCoupon.findOneAndUpdate({ _id: current._id }, { $set: fields }, { new: true, runValidators: true }).lean();
        return doc;
    } catch (err) {
        throw asConflict(err);
    }
}

export async function getPlatformCoupon(admin, id) {
    if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw new ApiError(404, 'Coupon not found');
    const doc = await PlatformCoupon.findById(id).lean();
    if (!doc || !canManagePlatformCoupon(admin, doc.services, false)) throw new ApiError(404, 'Coupon not found');
    return doc;
}
