import express from 'express';
import {
    calculateOrderController,
    createOrderController,
    verifyPaymentController,
    abandonOnlinePaymentController,
    listOrdersUserController,
    getOrderPaymentsUserController,
    getOrderByIdUserController,
    cancelOrderController,
    submitOrderRatingsController,
    getOrderDropOtpUserController,
    updateOrderInstructionsController,
    getOrderRouteUserController
} from '../controllers/order.controller.js';
import {
    calculateCheckoutController,
    createCheckoutController,
    getCheckoutByIdController,
    verifyCheckoutPaymentController,
    abandonCheckoutController,
    retryCheckoutPaymentController
} from '../controllers/checkout.controller.js';
import { getOrderReturnsUserController, createReturnUserController } from '../controllers/shipmentReturn.controller.js';
import { idempotency } from '../../../../../../middleware/idempotency.js';

const router = express.Router();

router.post('/checkout/calculate', calculateCheckoutController);
// A double tap placed two orders (the apps send no Idempotency-Key): the same
// customer sending the same body within 10 s is one request, as in Food and Quick.
const placeOnce = idempotency({ implicitWindowMs: 10_000 });

router.post('/checkout', placeOnce, createCheckoutController);
router.get('/checkout/:checkoutId', getCheckoutByIdController);
router.post('/checkout/:checkoutId/verify-payment', verifyCheckoutPaymentController);
router.post('/checkout/:checkoutId/abandon', abandonCheckoutController);
router.post('/checkout/:checkoutId/retry-payment', retryCheckoutPaymentController);

router.post('/calculate', calculateOrderController);
router.post('/', placeOnce, createOrderController);
router.post('/verify-payment', verifyPaymentController);
router.delete('/:orderId/pending-payment', abandonOnlinePaymentController);
router.get('/', listOrdersUserController);
router.get('/:orderId/payments', getOrderPaymentsUserController);
router.get('/:orderId/drop-otp', getOrderDropOtpUserController);
// Live route from the rider's current position to their next stop, for the tracking map.
router.get('/:orderId/route', getOrderRouteUserController);
router.get('/:orderId/returns', getOrderReturnsUserController);
router.post('/:orderId/returns', createReturnUserController);
router.get('/:orderId', getOrderByIdUserController);
router.patch('/:orderId/cancel', cancelOrderController);
router.patch('/:orderId/ratings', submitOrderRatingsController);
router.patch('/:orderId/instructions', updateOrderInstructionsController);

export default router;
