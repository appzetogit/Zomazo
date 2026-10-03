import { sendError } from '../../utils/response.js';
import { isAdminActive } from '../../../../core/admin/admin.model.js';

const isSuperAdmin = (admin) =>
    !admin?.adminType || admin?.adminType === 'super_admin' || admin?.isSuperAdmin === true;

const hasAction = (permissions, section, action) => {
    const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
    return actions.includes(action);
};

const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN';

const hydrateAdmin = async (req) => {
    if (req.adminAccess) return req.adminAccess;
    // Every admin is a platform admin since the ecom_admins merge
    // (core/admin/shopAdmin.js): one is admitted when servicesAccess names this
    // vertical (an empty list means unrestricted). Which sections a sub-admin
    // may open was decided earlier, by enforceAdminAccess, against the shared
    // permissions.
    const { FoodAdmin: PlatformAdmin } = await import('../../../../core/admin/admin.model.js');
    const platform = await PlatformAdmin.findById(req.user?.userId)
        .select('servicesAccess isActive isDeleted adminLevel admin_type role parentAdminId module permissions')
        .lean();
    if (!platform) return null;

    // Same rule as the platform's requireServiceAccess('ecommerce'), including its
    // superadmin pass: owner accounts predate this vertical and their explicit
    // servicesAccess lists do not name it.
    const { isPlatformSuperadmin } = await import('../../../../core/roles/serviceAccess.middleware.js');
    const access = Array.isArray(platform.servicesAccess) ? platform.servicesAccess : [];
    if (access.length > 0 && !access.includes('ecommerce') && !isPlatformSuperadmin(platform)) return null;

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
        if (!req.user?.userId || !isAdminRole(req.user?.role)) {
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
        if (!req.user?.userId || !isAdminRole(req.user?.role)) {
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
