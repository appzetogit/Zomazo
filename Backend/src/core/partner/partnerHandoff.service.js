/**
 * One partner, several businesses: a restaurant in Food, a store in Quick, a
 * seller in the Shop, a vendor in Services -- each with its own sign-in.
 * (Decided 30 Sep 2026: keep those sign-ins, and let a signed-in partner find
 * and open their other businesses without another OTP.)
 *
 * The partner pass. Every partner OTP sign-in also returns a pass: a signed
 * note of the phone number the OTP was sent to. With it, a partner can list the
 * businesses whose login phone is that number, and open any of them.
 *
 * Why the pass, and not the phone on the business they are signed into: in
 * Food, Quick and the Shop a partner can change their business's phone from
 * their profile without an OTP, so "the same phone as my restaurant" proves
 * nothing. The pass carries only a number someone proved they hold, and a
 * business it opens is one an OTP to that number would open anyway -- each
 * service's own sign-in matches the same fields the same way.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createRequire } from 'node:module';
import { ApiError } from '../../utils/ApiError.js';

const requireCjs = createRequire(import.meta.url);

const PASS_TTL = '30d';
const PASS_AUDIENCE = 'zomazo-partner-pass';

// A key of its own, derived from the app's secret, so a pass can never be
// mistaken for (or used as) a session token anywhere else.
const passKey = () => {
    const base = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
    if (!base) throw new Error('JWT secret is not configured');
    return crypto.createHash('sha256').update(`${base}:partner-pass`).digest('hex');
};

const tenDigits = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/** A pass for a phone number an OTP was just verified for. Null for a bad number. */
export function issuePartnerPass(phone) {
    const p = tenDigits(phone);
    if (p.length !== 10) return null;
    return jwt.sign({ p }, passKey(), { audience: PASS_AUDIENCE, expiresIn: PASS_TTL });
}

/** The verified phone a pass carries; throws 401 if it is missing, bad or expired. */
export function phoneFromPass(pass) {
    try {
        const { p } = jwt.verify(String(pass || ''), passKey(), { audience: PASS_AUDIENCE });
        if (tenDigits(p).length === 10) return tenDigits(p);
    } catch {
        // fall through
    }
    throw new ApiError(401, 'Sign in again to see your other businesses');
}

/*
 * How each service's sign-in finds a business by phone. Food, Quick and the
 * Shop match ownerPhone or primaryContactNumber ending in the number; Services
 * matches the vendor's phone.
 */
const endsWith = (p) => ({ $regex: new RegExp(`${p}$`) });
const KINDS = {
    food: {
        label: 'Food',
        collection: 'food_restaurants',
        byPhone: (p) => ({ $or: [{ ownerPhone: endsWith(p) }, { primaryContactNumber: endsWith(p) }] }),
        name: (d) => d.restaurantName,
        state: (d) => d.status || 'approved',
        home: '/food/restaurant',
    },
    quick: {
        label: 'Quick',
        collection: 'qc_restaurants',
        byPhone: (p) => ({ $or: [{ ownerPhone: endsWith(p) }, { primaryContactNumber: endsWith(p) }] }),
        name: (d) => d.restaurantName,
        state: (d) => d.status || 'approved',
        home: '/food/restaurant',
    },
    shop: {
        label: 'Shop',
        collection: 'ecom_sellers',
        byPhone: (p) => ({ $or: [{ ownerPhone: endsWith(p) }, { primaryContactNumber: endsWith(p) }] }),
        name: (d) => d.sellerName,
        state: (d) => d.status || 'approved',
        home: '/shop/seller',
    },
    services: {
        label: 'Services',
        collection: 'sp_vendors',
        byPhone: (p) => ({ phone: { $in: [p, `+91${p}`, `91${p}`] } }),
        name: (d) => d.businessName || d.name,
        state: (d) => (d.isActive === false ? 'deactivated' : d.approvalStatus || 'approved'),
        home: '/services/vendor',
    },
};
export const PARTNER_KINDS = Object.freeze(Object.keys(KINDS));

const PROJECTION = {
    restaurantName: 1, sellerName: 1, businessName: 1, name: 1,
    status: 1, approvalStatus: 1, isActive: 1,
};

/** Every business whose login phone is this number, in every service. */
export async function businessesForPhone(phone) {
    const p = tenDigits(phone);
    if (p.length !== 10) return [];
    const rows = await Promise.all(Object.entries(KINDS).map(async ([kind, k]) => {
        const docs = await mongoose.connection.collection(k.collection)
            .find(k.byPhone(p)).project(PROJECTION).limit(20).toArray();
        return docs.map((d) => ({
            kind,
            id: String(d._id),
            serviceLabel: k.label,
            name: String(k.name(d) || '').trim() || k.label,
            state: k.state(d),
            home: k.home,
        }));
    }));
    return rows.flat();
}

/**
 * Open one of the pass holder's businesses: that service's own session, by
 * that service's own sign-in rules (approval, suspension). Refuses a business
 * whose login phone is not the pass's number.
 */
export async function handOffTo({ pass, kind, id }) {
    const phone = phoneFromPass(pass);
    const k = KINDS[kind];
    if (!k || !mongoose.Types.ObjectId.isValid(String(id || ''))) throw new ApiError(404, 'Business not found');
    const _id = new mongoose.Types.ObjectId(String(id));
    const owned = await mongoose.connection.collection(k.collection)
        .findOne({ _id, ...k.byPhone(phone) }, { projection: { _id: 1 } });
    if (!owned) throw new ApiError(404, 'Business not found');

    const session = await SIGN_IN[kind](_id);
    return { kind, id: String(_id), home: k.home, session };
}

/** Each service's rules and session, as its OTP sign-in applies them. */
const refused = (err) => {
    throw new ApiError(403, err?.message || 'This business cannot be opened right now');
};
const SIGN_IN = {
    async food(id) {
        const [{ FoodRestaurant }, { issueFoodRestaurantSession }] = await Promise.all([
            import('../../modules/food/restaurant/models/restaurant.model.js'),
            import('../auth/auth.service.js'),
        ]);
        const doc = await FoodRestaurant.findById(id);
        if (doc.status && doc.status !== 'approved') refused({ message: 'This restaurant is not approved yet.' });
        return issueFoodRestaurantSession(doc);
    },
    async quick(id) {
        const [{ FoodRestaurant: QuickStore }, auth] = await Promise.all([
            import('../../modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js'),
            import('../../modules/quickCommerce/core/auth/auth.service.js'),
        ]);
        const doc = await QuickStore.findById(id);
        await auth.assertRestaurantMaySignIn(doc).catch(refused);
        return auth.issueRestaurantSession(doc);
    },
    async shop(id) {
        const [{ Seller }, auth] = await Promise.all([
            import('../../modules/ecommerce/modules/commerce/seller/models/seller.model.js'),
            import('../../modules/ecommerce/core/auth/auth.service.js'),
        ]);
        const doc = await Seller.findById(id);
        await auth.assertSellerMaySignIn(doc).catch(refused);
        return auth.issueSellerSession(doc);
    },
    async services(id) {
        const Vendor = requireCjs('../../modules/serviceProvider/models/Vendor.js');
        const { vendorSignInRefusal, issueVendorSession } = requireCjs('../../modules/serviceProvider/services/vendorSession.js');
        const doc = await Vendor.findById(id).lean();
        const why = vendorSignInRefusal(doc);
        if (why) refused({ message: why });
        return issueVendorSession(doc);
    },
};

/**
 * Registering a new business: the number it signs in with must be one the
 * registrant just verified by OTP. The OTP step returns a pass even when the
 * answer is "please register"; the onboarding form sends it back
 * (X-Partner-Pass). Without this, anyone could register a business on anyone's
 * number, and its owner signing in could land in it.
 */
export function assertPassForRegistration(pass, phone) {
    let verified = null;
    try {
        verified = phoneFromPass(pass);
    } catch {
        verified = null;
    }
    if (!verified || verified !== tenDigits(phone)) {
        throw new ApiError(403, 'Verify this mobile number with an OTP first, then submit again.');
    }
}
