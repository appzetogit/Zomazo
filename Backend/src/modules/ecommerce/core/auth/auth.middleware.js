import mongoose from 'mongoose';
import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
// The shared `users` collection: the Shop's customers since the ecom_users merge.
import { User } from '../users/user.model.js';
import { resolveShopCustomerId } from '../../../../core/identity/shopCustomer.js';
import { resolveShopAdminId } from '../../../../core/admin/shopAdmin.js';
import { Seller } from '../../modules/commerce/seller/models/seller.model.js';

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
 *
 * DELIVERY_PARTNER is absent too: this module ships by courier, and its own
 * rider app is not mounted, so no rider token is ever minted for it.
 */
const SESSION_SCOPED_MODELS = {
    USER: User,
    SELLER: Seller
};

const resolveSessionAccount = async (model, decoded) => {
    // The id under whichever name the issuer used (taxi signs `sub`). With no id
    // at all, findOne({ platformUserId: undefined }) becomes findOne({}) --
    // mongoose drops undefined keys -- and returns the FIRST customer.
    const id = decoded?.userId || decoded?.sub;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;

    // Customers are the platform's own accounts (the ecom_users merge). The id
    // may be a platform id or a pre-merge ecom_users id (an old Shop token):
    // both resolve to the platform account, merging a waiting ecom_users row on
    // the spot so its orders, cart and coins are there on this request.
    if (decoded.role === 'USER') return resolveShopCustomer(id);

    // A token minted by this module (a seller).
    return model.findById(id).select('isActive tokenVersion status').lean();
};

/**
 * The customer's platform account, as the Shop's session sees it: off when it
 * is off everywhere or only in the Shop (shopBlocked), with the Shop's own
 * single-device counter. The first visit marks them a Shop customer.
 */
const resolveShopCustomer = async (id) => {
    const customerId = await resolveShopCustomerId(id);
    if (!customerId) return null;
    const doc = await User.findById(customerId)
        .select('isActive shopTokenVersion shopBlocked shopJoinedAt')
        .lean();
    if (!doc) return null;
    if (!doc.shopJoinedAt) {
        await User.updateOne({ _id: doc._id, shopJoinedAt: null }, { $set: { shopJoinedAt: new Date() } });
    }
    return {
        _id: doc._id,
        isActive: doc.isActive !== false && doc.shopBlocked !== true,
        tokenVersion: doc.shopTokenVersion,
    };
};

/**
 * The Shop customer id (the platform id) for a platform account, marked a Shop
 * customer -- exactly as their first Shop request would. Used when a Shop
 * invite is redeemed at the platform sign-in. Null when there is no such
 * (active) platform account.
 */
export const ensureShopCustomer = async (platformUserId) => {
    const doc = await resolveSessionAccount(User, { userId: String(platformUserId || ''), role: 'USER' });
    return doc?._id && doc.isActive !== false ? String(doc._id) : null;
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
        // Uppercased like the platform's middleware: gates compare against
        // 'ADMIN' / 'USER' literals and some issuers mint lowercase roles.
        role: String(decoded.role || '').toUpperCase(),
        adminType: decoded.adminType
    };

    const normalizedDecoded = { ...decoded, role: req.user.role };
    const model = SESSION_SCOPED_MODELS[req.user.role];
    if (!model) {
        // Admins are checked by requireAdminPermission; anything else with no id
        // (a taxi token signed with `sub` and an unknown role) is refused here.
        const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
        if (!req.user.userId && !isAdmin) {
            return sendError(res, 401, 'Invalid token for this service');
        }
        if (!isAdmin || !req.user.userId) return next();
        // Admins are the platform's (the ecom_admins merge). A token naming an
        // old ecom_admins id is translated here, merging that admin on the spot
        // if the script has not yet.
        return resolveShopAdminId(req.user.userId)
            .then((adminId) => {
                if (!adminId) return sendError(res, 401, 'Account not found');
                req.user.userId = adminId;
                return next();
            })
            .catch(() => sendError(res, 401, 'Authentication failed'));
    }

    resolveSessionAccount(model, normalizedDecoded)
        .then((doc) => {
            if (!doc) return sendError(res, 401, 'Account not found');

            // Everything downstream addresses the customer by the platform id,
            // even when the token is an old Shop one naming an ecom_users id.
            req.user.userId = String(doc._id);
            if (normalizedDecoded.role === 'USER') {
                req.user.platformUserId = String(doc._id);
            }
            if (normalizedDecoded.role === 'USER' && doc.isActive === false) {
                return sendError(res, 401, 'User account is deactivated');
            }

            // A seller is re-checked on every request, as Food's stores are since
            // 22 Sep: a rejected seller kept full access until the token ran out.
            // A pending one keeps access to finish onboarding.
            if (normalizedDecoded.role === 'SELLER' && String(doc.status || '') === 'rejected') {
                return sendError(res, 403, 'This seller account is no longer active. Contact support.');
            }

            // A token minted before the latest login belongs to a replaced device.
            // Platform tokens carry no version and are accepted, as are tokens
            // minted before this feature shipped.
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

/**
 * Like authMiddleware, but a missing or bad token is simply "not signed in".
 *
 * A signed-in customer's platform id is still translated to their ecom_users
 * id -- but only when that satellite already exists. Browsing must never create
 * accounts as a side effect.
 */
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return next();
    }

    let decoded;
    try {
        decoded = verifyAccessToken(token);
    } catch (error) {
        return next();
    }

    req.user = {
        userId: decoded.userId,
        role: String(decoded.role || '').toUpperCase(),
        adminType: decoded.adminType
    };

    const id = decoded.userId || decoded.sub;
    if (req.user.role !== 'USER' || !id || !mongoose.Types.ObjectId.isValid(String(id))) {
        return next();
    }

    // Customers are platform accounts (the ecom_users merge); an old Shop
    // token's id is translated. Someone who never used the Shop is a guest here.
    resolveShopCustomerId(id)
        .then((customerId) => (customerId ? User.findById(customerId).select('_id shopJoinedAt').lean() : null))
        .then((doc) => {
            if (doc?.shopJoinedAt) {
                req.user.userId = String(doc._id);
                req.user.platformUserId = String(doc._id);
            } else {
                // Signed in on the platform, never used the shop: treat as a guest.
                req.user = undefined;
            }
            next();
        })
        .catch(() => {
            req.user = undefined;
            next();
        });
};
