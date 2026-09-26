import { sendResponse } from '../../../../utils/response.js';
import { listAdminLowStock } from '../services/adminLowStock.service.js';
import { releaseFirstOrderClaimByAdmin } from '../../orders/services/firstOrderClaimAdmin.service.js';

const handle = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req));
    } catch (err) {
        return next(err);
    }
};

/** GET /admin/inventory/low-stock?channel=&sellerId=&page=&limit= */
export const getLowStock = handle((req) => listAdminLowStock(req.query || {}), 'Low stock');

/** POST /admin/first-order-guard/claims/:id/release */
export const releaseFirstOrderClaim = handle((req) => releaseFirstOrderClaimByAdmin(req.params.id), 'Claim released');
