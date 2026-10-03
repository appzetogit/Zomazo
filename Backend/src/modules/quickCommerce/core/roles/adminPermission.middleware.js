/**
 * Quick-commerce's section gate (requireAdminPermission).
 *
 * Since the qc_admins merge (core/admin/quickAdmin.js) every Quick admin is a
 * platform admin in `admins`, whose sections are enforced for this API by
 * core/admin/enforceAdminAccess.middleware.js against the shared permissions.
 * This gate only admits an active admin whose servicesAccess names Quick or
 * Medical; requireFinancePermission now finds every Quick admin in `admins`.
 */
import { sendError } from '../../utils/response.js';
import { isAdminActive } from '../../../../core/admin/admin.model.js';

const isSuperAdmin = (admin) =>
    !admin?.adminType || admin?.adminType === 'super_admin' || admin?.isSuperAdmin === true;

const hasAction = (permissions, section, action) => {
    const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
    return actions.includes(action);
};

const hydrateAdmin = async (req) => {
    if (req.adminAccess) return req.adminAccess;
    // Every admin is a platform admin since the qc_admins merge
    // (core/admin/quickAdmin.js): one is admitted when their servicesAccess names
    // this vertical (an absent/empty list means unrestricted, matching SP's
    // serviceAccess rule). Which sections a sub-admin may open was decided
    // earlier, by enforceAdminAccess, against the shared permissions.
    const { FoodAdmin: PlatformAdmin } = await import('../../../../core/admin/admin.model.js');
    const platform = await PlatformAdmin.findById(req.user?.userId)
        .select('role servicesAccess adminLevel isActive isDeleted')
        .lean();
    if (!platform) return null;

    const access = Array.isArray(platform.servicesAccess) ? platform.servicesAccess : [];
    // Medical is served by this API too; which sections a platform sub-admin may
    // open here is decided earlier, by enforceAdminAccess.
    if (access.length > 0 && !access.includes('quickCommerce') && !access.includes('medical')) return null;

    const bridged = {
        // Sections are enforced by enforceAdminAccess; nothing more to check here.
        adminType: 'super_admin',
        permissions: {},
        isActive: platform.isActive !== false,
        isDeleted: platform.isDeleted === true
    };
    req.adminAccess = bridged;
    return bridged;
};

export const requireAdminPermission = (section, action = 'view') => async (req, res, next) => {
    try {
        if (!req.user?.userId || !['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || !isAdminActive(admin)) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        if (!hasAction(admin.permissions, section, action)) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};

export const requireAnyAdminPermission = (rules = []) => async (req, res, next) => {
    try {
        if (!req.user?.userId || !['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || !isAdminActive(admin)) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        const allowed = Array.isArray(rules) && rules.some((rule) => {
            const section = rule?.section;
            const action = rule?.action || 'view';
            if (!section) return false;
            return hasAction(admin.permissions, section, action);
        });

        if (!allowed) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};
