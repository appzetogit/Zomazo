import { sendError } from '../../utils/response.js';
import { ADMIN_LEVELS } from '../admin/adminHierarchy.constants.js';
import { resolveAdminLevel } from '../admin/adminHierarchy.service.js';

export const isPlatformSuperadmin = (admin) => resolveAdminLevel(admin) === ADMIN_LEVELS.PLATFORM_SUPERADMIN;

/**
 * Server-side enforcement of per-vertical admin access.
 *
 * Until now servicesAccess gated only the sidebar tabs: any admin token reached every
 * vertical's admin API directly, because requireRoles knows roles, not verticals, and
 * hasModuleAccess existed without a single caller. Service-provider was the only
 * vertical that enforced it. This middleware closes that for the rest.
 *
 * The rule matches SP's serviceAccess.js exactly, so one mental model covers the
 * platform: a non-empty servicesAccess must name the vertical; an absent or empty
 * list means unrestricted (legacy admins created before scoping existed).
 *
 * Mounted AFTER authMiddleware + requireRoles('ADMIN'), so req.user is a verified
 * admin token by the time this runs. One indexed lookup per request; results are not
 * cached so a revoked vertical takes effect on the admin's next request, not their
 * next login.
 */
export const requireServiceAccess = (vertical) => async (req, res, next) => {
    try {
        // The three verticals' auth middlewares attach the subject differently:
        // core sets req.user.userId, taxi sets req.auth.sub. Same fallbacks as the
        // activity controller.
        const userId = req.user?.userId || req.user?.id || req.auth?.sub;
        if (!userId) return sendError(res, 401, 'Not authenticated');

        const { FoodAdmin } = await import('../admin/admin.model.js');
        const select = 'servicesAccess isActive isDeleted adminLevel admin_type role parentAdminId module permissions';
        let admin = await FoodAdmin.findById(userId).select(select).lean();

        // Quick's own admins are platform admins since the qc_admins merge
        // (core/admin/quickAdmin.js); an old qc_admins id is translated (and that
        // admin merged, if the script has not yet). Any other unknown id is
        // refused: a deleted admin's token, or another module's admin.
        if (!admin && vertical === 'quickCommerce') {
            const { resolveQuickAdminId } = await import('../admin/quickAdmin.js');
            const merged = await resolveQuickAdminId(userId);
            if (merged) admin = await FoodAdmin.findById(merged).select(select).lean();
        }
        // The Shop's admins likewise since the ecom_admins merge (core/admin/shopAdmin.js).
        if (!admin && vertical === 'ecommerce') {
            const { resolveShopAdminId } = await import('../admin/shopAdmin.js');
            const merged = await resolveShopAdminId(userId);
            if (merged) admin = await FoodAdmin.findById(merged).select(select).lean();
        }
        if (!admin) return sendError(res, 403, 'Admin account not found');

        if (admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        const access = Array.isArray(admin.servicesAccess) ? admin.servicesAccess : [];

        // E-commerce arrived after every owner account was created, and owners carry
        // an explicit list (platformAdmins.service), so without this each of them
        // would be locked out of the new panel until someone ran a grant script.
        // The platform superadmin passes everything by policy (adminAccessPolicy.js).
        // Scoped to e-commerce so no existing vertical's access changes.
        if (vertical === 'ecommerce' && isPlatformSuperadmin(admin)) return next();

        // The quick-commerce API also serves the Medical panel (a pharmacy is a
        // quick-commerce seller), so Medical access admits an admin to it; what
        // they may see there is narrowed by enforceAdminAccess.
        const admits = vertical === 'quickCommerce' ? ['quickCommerce', 'medical'] : [vertical];
        if (access.length > 0 && !admits.some((v) => access.includes(v))) {
            return sendError(res, 403, `Forbidden: no access to the ${vertical} vertical`);
        }

        return next();
    } catch (error) {
        return next(error);
    }
};
