import express from 'express';
import * as c from '../controllers/courierOps.controller.js';

/**
 * Mounted inside the admin router (/v1/admin), after its auth and its
 * path -> section check ('/shipments' and '/checkouts' are order_management,
 * '/cod-remittances' is report_management).
 */
const router = express.Router();

router.get('/shipments/ndr', c.listNdrController);
router.post('/shipments/ndr/:orderId/action', c.ndrActionController);
router.get('/shipments/rto', c.listRtoController);
router.post('/shipments/rto/:orderId/receive', c.receiveRtoController);

router.get('/cod-remittances', c.listRemittancesController);
router.get('/cod-remittances/summary', c.codSummaryController);
router.get('/cod-remittances/outstanding', c.codOutstandingController);
router.post('/cod-remittances/preview', c.previewRemittanceController);
router.post('/cod-remittances', c.createRemittanceController);
router.get('/cod-remittances/:id', c.getRemittanceController);

router.get('/checkouts', c.listCheckoutsController);
router.get('/checkouts/:checkoutId', c.getCheckoutController);

export default router;
