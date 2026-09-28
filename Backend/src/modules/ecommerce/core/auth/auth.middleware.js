import mongoose from 'mongoose';
import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
import { User } from '../users/user.model.js';
// The shared `users` collection -- the customer's one identity across the whole
// platform. Aliased so it cannot be confused with this module's satellite above.
import { FoodUser as PlatformUser } from '../../../../core/users/user.model.js';
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

/**
 * The account this token belongs to, or null.
 *
 * Mirrors quick-commerce's resolveSessionAccount. Only USER is translated: a
 * customer signs in ONCE on the platform, and their token carries the platform
 * id. This module keys orders, carts and addresses on its own ecom_users row, so
 * that row is found -- or made -- here, once, rather than in every controller.
 *
 * Never throws: any failure returns null and the caller answers 401.
 */
const resolveSessionAccount = async (model, decoded) => {
    const select = 'isActive tokenVersion';
    // The id under whichever name the issuer used (taxi signs `sub`). With no id
    // at all, findOne({ platformUserId: undefined }) becomes findOne({}) --
    // mongoose drops undefined keys -- and returns the FIRST customer.
    const id = decoded?.userId || decoded?.sub;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;

    // 1. A token minted by this module (a seller, or a satellite id).
    const direct = await model.findById(id).select(select).lean();
    if (direct) return direct;

    if (decoded.role !== 'USER') return null;

    // 2. A platform token whose satellite is already linked.
    const linked = await model.findOne({ platformUserId: id }).select(select).lean();
    if (linked) return linked;

    // 3. No satellite yet. The customer is real -- they are in the shared users
    //    collection -- so one is made for them rather than refusing the request.
    const platform = await PlatformUser.findById(id).select('phone name email isActive').lean();
    if (!platform || platform.isActive === false) return null;

    // Phones are stored inconsistently across verticals (+91, spaced, bare), so
    // they are matched on the last ten digits, as core/identity does.
    const suffix = String(platform.phone || '').replace(/\D/g, '').slice(-10);
    if (suffix.length !== 10) return null;
    const byPhone = new RegExp(suffix + '$');

    // Adopt a row imported from the standalone app before creating a second one
    // for the same phone, which would split that customer's orders in two.
    const orphan = await model.findOne({ phone: byPhone, platformUserId: null }).select(select).lean();
    if (orphan) {
        await model.updateOne({ _id: orphan._id }, { $set: { platformUserId: id } });
        return orphan;
    }

    try {
        const created = await model.create({
            phone: suffix,
            platformUserId: id,
            isVerified: true,
            ...(platform.name ? { name: platform.name } : {}),
            ...(platform.email ? { email: platform.email } : {})
        });
        return { _id: created._id, isActive: true, tokenVersion: created.tokenVersion };
    } catch (err) {
        // Two first requests racing: the unique phone index makes one lose.
        if (err && err.code === 11000) {
            return model.findOne({ phone: byPhone }).select(select).lean();
        }
        return null;
    }
};

/**
 * The Shop customer row for a platform account, made on the spot if the
 * customer has never opened the Shop -- exactly as their first Shop request
 * would. Used when a Shop invite is redeemed at the platform sign-in, before
 * the new customer has been anywhere near the Shop. Null when there is no
 * such (active) platform account.
 */
export const ensureShopCustomer = async (platformUserId) => {
    const doc = await resolveSessionAccount(User, { userId: String(platformUserId || ''), role: 'USER' });
    return doc?._id ? String(doc._id) : null;
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
        return next();
    }

    resolveSessionAccount(model, normalizedDecoded)
        .then((doc) => {
            if (!doc) return sendError(res, 401, 'Account not found');

            // Everything downstream addresses the customer by the ecom_users id.
            req.user.userId = String(doc._id);
            if (normalizedDecoded.role === 'USER') {
                req.user.platformUserId = String(decoded.userId || decoded.sub);
            }
            if (normalizedDecoded.role === 'USER' && doc.isActive === false) {
                return sendError(res, 401, 'User account is deactivated');
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

    User.findOne({ $or: [{ _id: id }, { platformUserId: id }] })
        .select('_id')
        .lean()
        .then((doc) => {
            if (doc) {
                req.user.userId = String(doc._id);
                req.user.platformUserId = String(id);
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
