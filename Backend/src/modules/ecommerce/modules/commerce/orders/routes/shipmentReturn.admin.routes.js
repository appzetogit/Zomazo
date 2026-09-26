import express from 'express';
import * as c from '../controllers/shipmentReturn.controller.js';

/**
 * Mounted inside the admin router (/v1/admin), after its auth and its
 * path -> section permission check ('/shipments' and '/returns' are
 * order_management), so these handlers need no guards of their own.
 */
const router = express.Router();

router.get('/shipments', c.listShipmentsAdminController);
router.get('/shipments/:orderId/tracking', c.trackShipmentAdminController);
router.post('/shipments/:orderId/book', c.bookShipmentAdminController);
router.post('/shipments/:orderId/cancel', c.cancelShipmentAdminController);

router.get('/returns', c.listReturnsAdminController);
router.get('/returns/settings', c.getReturnSettingsAdminController);
router.patch('/returns/settings', c.updateReturnSettingsAdminController);
router.get('/returns/:id', c.getReturnAdminController);
router.post('/returns/:id/approve', c.approveReturnAdminController);
router.post('/returns/:id/reject', c.rejectReturnAdminController);
router.post('/returns/:id/receive', c.receiveReturnAdminController);

export default router;
