import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { FirstOrderClaim, FirstOrderGuardSettings } from '../models/firstOrderClaim.model.js';
import { Checkout } from '../models/checkout.model.js';
import { Order } from '../models/order.model.js';
import { User } from '../../../../core/users/user.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';

/**
 * First-order abuse guard: a first-order offer is used once per person, where a
 * person is any of account, verified phone, device id and payment instrument.
 * Every signal is stored as a peppered HMAC, never in the clear.
 */

const SIGNALS = ['account', 'phone', 'device', 'payment'];
const CANCELLED = ['cancelled_by_user', 'cancelled_by_seller', 'cancelled_by_admin'];
/** A claim is made just before its order is written; give that write time to land. */
const CLAIM_GRACE_MS = 2 * 60 * 1000;

const REASONS = {
    account: 'This account has already used its first-order offer.',
    phone: 'This phone number has already been used for a first-order offer.',
    device: 'A first-order offer has already been used on this device.',
    payment: 'This card or UPI ID has already been used for a first-order offer.',
};

let warnedPepper = false;
const pepper = () => {
    const value = String(process.env.FIRST_ORDER_PEPPER || '').trim();
    if (value) return value;
    if (!warnedPepper) {
        warnedPepper = true;
        logger.warn('FIRST_ORDER_PEPPER is not set; first-order signals are hashed with a fallback pepper');
    }
    return `first-order:${process.env.JWT_ACCESS_SECRET || 'dev'}`;
};

export const hashSignal = (kind, value) => {
    const clean = String(value ?? '').trim();
    if (!clean) return undefined;
    return crypto.createHmac('sha256', pepper()).update(`${kind}:${clean}`).digest('hex');
};

const normalizePhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    return digits.length === 10 ? digits : '';
};

/** Stable device ids only: printable, bounded. Anything else is ignored. */
export const normalizeDeviceId = (raw) => {
    const value = String(raw || '').trim();
    return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : '';
};

/** The card or UPI instrument of a Razorpay payment entity, if it has one. */
export const paymentInstrumentOf = (payment = {}) => {
    if (!payment || typeof payment !== 'object') return '';
    if (payment.vpa) return `upi:${String(payment.vpa).toLowerCase()}`;
    if (payment.upi?.vpa) return `upi:${String(payment.upi.vpa).toLowerCase()}`;
    if (payment.card?.fingerprint) return `cardfp:${payment.card.fingerprint}`;
    if (payment.card_id) return `card:${payment.card_id}`;
    if (payment.card?.id) return `card:${payment.card.id}`;
    return '';
};

export async function getFirstOrderGuardSettings() {
    const doc = await FirstOrderGuardSettings.findOneAndUpdate(
        { key: 'default' },
        { $setOnInsert: { key: 'default' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    const signals = {};
    for (const s of SIGNALS) signals[s] = doc?.signals?.[s] !== false;
    return { signals, updatedAt: doc?.updatedAt || null };
}

export async function updateFirstOrderGuardSettings(body = {}, adminId = null) {
    const set = {};
    const input = body?.signals && typeof body.signals === 'object' ? body.signals : body;
    for (const s of SIGNALS) {
        if (input?.[s] !== undefined) set[`signals.${s}`] = Boolean(input[s]);
    }
    if (adminId && mongoose.Types.ObjectId.isValid(String(adminId))) set.updatedBy = new mongoose.Types.ObjectId(String(adminId));
    await FirstOrderGuardSettings.updateOne({ key: 'default' }, { $set: set }, { upsert: true });
    return getFirstOrderGuardSettings();
}

/** The hashed signals of this person, limited to the ones switched on. */
async function signalsFor({ userId, deviceId, paymentInstrument } = {}, settings) {
    const { signals } = settings || (await getFirstOrderGuardSettings());
    const out = {};
    if (signals.account && userId && mongoose.Types.ObjectId.isValid(String(userId))) {
        out.userId = new mongoose.Types.ObjectId(String(userId));
    }
    if (signals.phone && userId && mongoose.Types.ObjectId.isValid(String(userId))) {
        const user = await User.findById(userId).select('phone').lean();
        const phone = normalizePhone(user?.phone);
        if (phone) out.phoneHash = hashSignal('phone', phone);
    }
    if (signals.device) {
        const device = normalizeDeviceId(deviceId);
        if (device) out.deviceIdHash = hashSignal('device', device);
    }
    if (signals.payment && paymentInstrument) out.paymentHash = hashSignal('payment', paymentInstrument);
    return out;
}

const SIGNAL_FIELD = { userId: 'account', phoneHash: 'phone', deviceIdHash: 'device', paymentHash: 'payment' };

/**
 * True when the order behind a claim never really happened: its checkout or
 * order is gone, the checkout was abandoned, or every order was cancelled.
 */
async function isVoid(claim, now = new Date()) {
    const young = now - new Date(claim.createdAt || now) < CLAIM_GRACE_MS;
    if (claim.checkoutId) {
        const checkout = await Checkout.findById(claim.checkoutId).select('status').lean();
        if (!checkout) return !young;
        if (checkout.status === 'cancelled') return true;
        const orders = await Order.find({ checkoutId: claim.checkoutId }).select('orderStatus').lean();
        if (!orders.length) return !young;
        return orders.every((o) => CANCELLED.includes(o.orderStatus));
    }
    if (claim.orderId) {
        const order = await Order.findById(claim.orderId).select('orderStatus').lean();
        if (!order) return !young;
        return CANCELLED.includes(order.orderStatus);
    }
    return !young;
}

/** Deletes a claim whose order never happened. Returns true if it was released. */
async function releaseIfVoid(claim) {
    if (!(await isVoid(claim))) return false;
    await FirstOrderClaim.deleteOne({ _id: claim._id });
    logger.info(`First-order claim ${claim._id} released (order did not go ahead)`);
    return true;
}

/** The first live claim that shares a signal with these, and which signal it shares. */
async function findBlocking(signals, { exceptId } = {}) {
    const or = Object.entries(signals).map(([field, value]) => ({ [field]: value }));
    if (!or.length) return null;
    const query = { $or: or };
    if (exceptId) query._id = { $ne: exceptId };
    const claims = await FirstOrderClaim.find(query).lean();
    for (const claim of claims) {
        if (await releaseIfVoid(claim)) continue;
        const field = Object.keys(signals).find((f) => String(claim[f] ?? '') === String(signals[f]));
        const signal = SIGNAL_FIELD[field] || 'account';
        return { claim, signal, reason: REASONS[signal] };
    }
    return null;
}

/**
 * Whether this person may still use a first-order offer.
 * `{ ok: true }` or `{ ok: false, signal, reason }`.
 */
export async function checkFirstOrderEligibility({ userId, deviceId } = {}) {
    const signals = await signalsFor({ userId, deviceId });
    const blocking = await findBlocking(signals);
    return blocking ? { ok: false, signal: blocking.signal, reason: blocking.reason } : { ok: true };
}

/**
 * Takes the first-order offer for a checkout or an order. Atomic: the unique
 * indexes decide a race, and the loser gets a ValidationError with the reason.
 */
export async function claimFirstOrder({ userId, deviceId, checkoutId = null, orderId = null, offerCode = '' } = {}) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
        throw new ValidationError('Sign in to use a first-order offer');
    }
    const signals = await signalsFor({ userId, deviceId });
    const doc = {
        ownerUserId: new mongoose.Types.ObjectId(String(userId)),
        ...signals,
        checkoutId: checkoutId ? new mongoose.Types.ObjectId(String(checkoutId)) : null,
        orderId: orderId ? new mongoose.Types.ObjectId(String(orderId)) : null,
        offerCode: String(offerCode || ''),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const claim = await FirstOrderClaim.create(doc);
            return claim.toObject();
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // Someone holds one of these signals. A claim whose order never
            // happened is released and the insert retried; a live one refuses.
            const blocking = await findBlocking(signals);
            if (blocking) {
                const error = new ValidationError(blocking.reason);
                error.code = 'FIRST_ORDER_ALREADY_USED';
                error.data = { signal: blocking.signal };
                throw error;
            }
        }
    }
    throw new ValidationError('Could not apply the first-order offer. Please try again.');
}

const refFilter = ({ checkoutId, orderId } = {}) => {
    if (checkoutId) return { checkoutId: new mongoose.Types.ObjectId(String(checkoutId)) };
    if (orderId) return { orderId: new mongoose.Types.ObjectId(String(orderId)) };
    return null;
};

/** Gives the offer back: the checkout/order was abandoned or unwound. */
export async function releaseFirstOrderClaim(ref = {}) {
    const filter = refFilter(ref);
    if (!filter) return { released: 0 };
    const res = await FirstOrderClaim.deleteMany(filter);
    return { released: Number(res?.deletedCount || 0) };
}

/** Releases the claim only if its order has really been cancelled (e.g. after a cancel). */
export async function releaseFirstOrderClaimIfVoid(ref = {}) {
    const filter = refFilter(ref);
    if (!filter) return { released: 0 };
    let released = 0;
    for (const claim of await FirstOrderClaim.find(filter).lean()) {
        if (await releaseIfVoid(claim)) released += 1;
    }
    return { released };
}

/**
 * Adds the paying card/UPI to the claim once the payment is known. The payment
 * has already been taken by then, so a match with another person's claim does
 * not undo it: the claim is flagged for review and blocks the instrument's
 * next first order instead.
 */
export async function recordPaymentFingerprint({ checkoutId, orderId, payment } = {}) {
    const filter = refFilter({ checkoutId, orderId });
    if (!filter) return { recorded: false };
    const { signals } = await getFirstOrderGuardSettings();
    if (!signals.payment) return { recorded: false };
    const instrument = paymentInstrumentOf(payment);
    if (!instrument) return { recorded: false };
    const paymentHash = hashSignal('payment', instrument);
    const claim = await FirstOrderClaim.findOne(filter).lean();
    if (!claim) return { recorded: false };
    if (claim.paymentHash === paymentHash) return { recorded: true };
    const other = await findBlocking({ paymentHash }, { exceptId: claim._id });
    if (other) {
        await FirstOrderClaim.updateOne(
            { _id: claim._id },
            { $set: { flagged: true, flagReason: `Payment instrument already used by claim ${other.claim._id}` } },
        );
        return { recorded: false, flagged: true };
    }
    try {
        await FirstOrderClaim.updateOne({ _id: claim._id }, { $set: { paymentHash } });
        return { recorded: true };
    } catch (err) {
        if (err?.code !== 11000) throw err;
        await FirstOrderClaim.updateOne({ _id: claim._id }, { $set: { flagged: true, flagReason: 'Payment instrument already used' } });
        return { recorded: false, flagged: true };
    }
}

export async function listFirstOrderClaims({ page = 1, limit = 20, flagged } = {}) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.max(1, Math.min(100, Number(limit) || 20));
    const query = {};
    if (flagged === true || flagged === 'true') query.flagged = true;
    const [items, total] = await Promise.all([
        FirstOrderClaim.find(query)
            .sort({ createdAt: -1 })
            .skip((p - 1) * l)
            .limit(l)
            .populate('ownerUserId', 'name phone')
            .lean(),
        FirstOrderClaim.countDocuments(query),
    ]);
    return {
        items: items.map((c) => ({
            _id: c._id,
            user: c.ownerUserId,
            checkoutId: c.checkoutId,
            orderId: c.orderId,
            offerCode: c.offerCode,
            signals: {
                account: Boolean(c.userId),
                phone: Boolean(c.phoneHash),
                device: Boolean(c.deviceIdHash),
                payment: Boolean(c.paymentHash),
            },
            flagged: c.flagged,
            flagReason: c.flagReason,
            createdAt: c.createdAt,
        })),
        pagination: { page: p, limit: l, total, totalPages: Math.max(1, Math.ceil(total / l)) },
    };
}
