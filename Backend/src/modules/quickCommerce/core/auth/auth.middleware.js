import mongoose from 'mongoose';
import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
// The shared `users` collection: Quick's customers since the qc_users merge.
import { FoodUser } from '../users/user.model.js';
import { resolveQuickCustomerId } from '../../../../core/identity/quickCustomer.js';
import { resolveQuickAdminId } from '../../../../core/admin/quickAdmin.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { resolveQcPartnerForFoodRider } from '../../../../core/identity/qcRiderBridge.js';

export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return sendError(res, 403, 'Admin access required');
    }
    next();
};

/**
 * Accounts whose sessions are single-device.
 *
 * Admins are intentionally absent: the panel is routinely used across several
 * browser tabs and machines, so evicting the others on each sign-in would be a
 * regression rather than a safeguard.
 */
const SESSION_SCOPED_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner
};

/**
 * The satellite account this token belongs to, or null.
 *
 * Only USER is translated. A restaurant or delivery token is minted by this
 * module's own login and already carries the right id, so those keep the
 * single findById they have always had.
 *
 * Never throws: any failure returns null and the caller answers 401, which is
 * what an unresolvable token deserves and what it did before.
 */
const resolveSessionAccount = async (model, decoded) => {
    // The id under whichever name the issuer used (taxi signs `sub`). With no
    // id at all, `findOne({ platformUserId: undefined })` became `findOne({})`
    // -- mongoose drops undefined keys -- and returned the FIRST customer, so a
    // taxi token signed in as someone else entirely.
    const id = decoded?.userId || decoded?.sub;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;

    // Customers are the platform's own accounts (the qc_users merge). The id
    // may be a platform id or a pre-merge qc_users id (an old Quick token):
    // both resolve to the platform account, merging a waiting qc_users row on
    // the spot so its orders and cart are there on this request.
    if (decoded.role === 'USER') return resolveQuickCustomer(id);

    // A token minted by this module: the id IS the account id.
    const direct = await model.findById(id).select('isActive tokenVersion status').lean();
    if (direct) return direct;

    // A rider signed in through the platform rider app carries their FOOD
    // partner id. The bridge finds (or makes) their grocery-pool row and syncs
    // availability onto it, so the one app gets both kinds of job.
    if (decoded.role === 'DELIVERY_PARTNER') {
        const bridged = await resolveQcPartnerForFoodRider(id);
        if (!bridged) return null;
        return {
            _id: bridged._id,
            tokenVersion: bridged.tokenVersion,
            status: bridged.status,
            bridgedFrom: String(id)
        };
    }
    return null;
};

/**
 * The customer's platform account, as the session sees it. `isActive` is
 * false when the account is off everywhere or only in Quick (quickBlocked,
 * set by Quick's admin). The first visit marks them a Quick customer, which
 * is what Quick's admin lists.
 */
const resolveQuickCustomer = async (id) => {
    const customerId = await resolveQuickCustomerId(id);
    if (!customerId) return null;
    const doc = await FoodUser.findById(customerId)
        .select('isActive tokenVersion quickBlocked quickJoinedAt')
        .lean();
    if (!doc) return null;
    if (!doc.quickJoinedAt) {
        await FoodUser.updateOne({ _id: doc._id, quickJoinedAt: null }, { $set: { quickJoinedAt: new Date() } });
    }
    return { ...doc, isActive: doc.isActive !== false && doc.quickBlocked !== true };
};

/**
 * This customer's Quick id (their platform id) for a platform account, marked
 * a Quick customer -- what the first signed-in request would do anyway. Lets
 * an invite be credited in Quick at the one sign-in
 * (core/referral/signupReferral.service.js).
 */
export const ensureQuickCustomer = async (platformUserId) => {
    const row = await resolveSessionAccount(FoodUser, { userId: String(platformUserId || ''), role: 'USER' });
    return row?._id || null;
};

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    let decoded;
    try {
        decoded = verifyAccessToken(token);
    } catch (error) {
        return sendError(res, 401, 'Invalid or expired token');
    }

    req.user = {
        userId: decoded.userId,
        // Uppercased to match master's middleware: every role gate downstream compares
        // against 'ADMIN'/'SUPER_ADMIN' literals, and tokens mint lowercase roles.
        role: String(decoded.role || '').toUpperCase(),
        adminType: decoded.adminType
    };

    /*
     * Looked up by the UPPERCASED role, and the account must resolve.
     *
     * Keyed on the raw role, a token whose role differed only in case -- a taxi
     * customer token { role: 'user', sub } -- found no model and went straight through
     * as role USER with no userId. Every module signs with the same secret, so any
     * self-registered taxi customer got in, and getOrderById's `if (userId && ...)`
     * ownership check was skipped: any quick-commerce order, with the customer's and
     * rider's names, phones and address. Now such a token must resolve to a real
     * account like any other (a genuine account whose role is stored lowercase still
     * does), and a non-admin token with no user id is refused.
     */
    const normalizedDecoded = { ...decoded, role: req.user.role };
    const model = SESSION_SCOPED_MODELS[req.user.role];
    if (!model) {
        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        if (!req.user.userId && !isAdmin) {
            return sendError(res, 401, 'Invalid token for this service');
        }
        if (!isAdmin || !req.user.userId) return next();
        // Admins are the platform's (the qc_admins merge). A token from Quick's
        // own admin sign-in before the merge names a qc_admins id: translated
        // here, merging that admin on the spot if the script has not yet.
        return resolveQuickAdminId(req.user.userId)
            .then((adminId) => {
                if (!adminId) return sendError(res, 401, 'Account not found');
                req.user.userId = adminId;
                return next();
            })
            .catch(() => sendError(res, 401, 'Authentication failed'));
    }

    // One indexed lookup of two small fields. USER already paid for this to check
    // isActive; the version travels in the same query rather than a second round
    // trip, and the other two roles now share the same path.
    resolveSessionAccount(model, normalizedDecoded)
        .then((doc) => {
            if (!doc) return sendError(res, 401, 'Account not found');

            // The id the rest of this module keys on. For a customer it is the
            // platform id even when the token is an old Quick one naming a
            // qc_users id -- translated here, once, rather than per controller.
            req.user.userId = String(doc._id);
            req.user.platformUserId = normalizedDecoded.role === 'USER' ? String(doc._id) : String(decoded.userId);
            if (normalizedDecoded.role === 'USER' && doc.isActive === false) {
                return sendError(res, 401, 'User account is deactivated');
            }
            if (doc.bridgedFrom) {
                req.user.platformDeliveryPartnerId = doc.bridgedFrom;
                // Food only signs in approved riders, but a token outlives a
                // later rejection -- and QC's own admin can bar the rider here.
                if (doc.status !== 'approved') {
                    return sendError(res, 403, 'Your delivery account is not approved for quick commerce deliveries.');
                }
                // Food tokens carry no version of their own; the grocery row's
                // counter belongs to QC's own login, so it is not compared.
                return next();
            }

            // Stores and riders are re-checked on every request, as in Food since
            // 22 Sep: approval was only checked at login, so an account an admin
            // rejected kept full access until its token ran out. Pending ones keep
            // access to finish onboarding.
            if (['RESTAURANT', 'DELIVERY_PARTNER'].includes(normalizedDecoded.role)
                && ['rejected', 'deactivated'].includes(String(doc.status || ''))) {
                return sendError(res, 403, 'This account is no longer active. Contact support.');
            }

            // A token minted before the latest login belongs to a device that has
            // since been replaced.
            //
            // Tokens issued BEFORE this feature shipped carry no version at all.
            // Treating those as 0 would sign every existing user out the moment a
            // single new login bumped anyone; instead they are accepted until the
            // account next logs in, which is when the eviction genuinely applies.
            const stored = Number(doc.tokenVersion) || 0;
            const presented = decoded.tokenVersion;
            if (presented !== undefined && Number(presented) !== stored) {
                return sendError(
                    res,
                    401,
                    'You have been signed out because this account was used on another device'
                );
            }

            return next();
        })
        .catch(() => sendError(res, 401, 'Authentication failed'));
};
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            userId: decoded.userId,
            role: decoded.role,
            adminType: decoded.adminType
        };
        next();
    } catch (error) {
        // Silently ignore invalid tokens in optional auth
        next();
    }
};
