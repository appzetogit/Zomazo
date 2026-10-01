import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { decideAdminAccess, isRestrictedAdmin } from '../admin/adminAccessPolicy.js';
import { listPlatformOrders, PLATFORM_ORDER_SOURCES } from './platformOrders.service.js';

/**
 * Master > All orders: /v1/platform/orders.
 *
 * Every service's orders, rides and bookings from the one common record
 * (platform_orders), newest first, filtered by service, status, dates,
 * customer phone, partner and order number. Read-only. A sub-admin sees only
 * the services whose Orders they may read (the shared permission policy).
 */
const router = express.Router();

router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
});
router.use(authMiddleware, requireRoles('ADMIN'));

/** The services this admin may see orders of. */
export function servicesVisibleTo(admin) {
    const all = Object.keys(PLATFORM_ORDER_SOURCES);
    if (!admin || admin.isActive === false) return [];
    if (!isRestrictedAdmin(admin)) return all;
    return all.filter((service) => {
        if (service === 'serviceProvider') {
            // Services has its own admin gate (servicesAccess names it).
            return Array.isArray(admin.servicesAccess) && admin.servicesAccess.includes('serviceProvider');
        }
        return decideAdminAccess(admin, { service, resource: 'orders', write: false }).allowed;
    });
}

router.get('/', async (req, res) => {
    try {
        const admin = await loadAdminCached(req.user?.userId || req.user?.id);
        if (!admin) return sendError(res, 403, 'Admin account not found');
        const visible = servicesVisibleTo(admin);
        if (!visible.length) return sendError(res, 403, 'You do not have access to orders');
        const wanted = String(req.query.service || '');
        if (wanted && !visible.includes(wanted)) return sendError(res, 403, 'You do not have access to this service\'s orders');
        const services = wanted ? [wanted] : visible;
        const out = await listPlatformOrders({ ...req.query, services });
        return sendResponse(res, 200, 'OK', { ...out, services: visible });
    } catch (err) {
        return sendError(res, 500, 'Could not load orders. Please try again.');
    }
});

export default router;
