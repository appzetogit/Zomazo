import express from 'express';
import mongoose from 'mongoose';
import {
    getPaymentHistoryController,
    getOrderTransactionsController,
    getUserWalletBalanceController,
    getUserWalletTransactionsController,
    getSellerWalletController,
    getDeliveryWalletController,
    getAdminWalletController,
    getAdminFinanceSummaryController,
    listSettlementsController,
    createSettlementController,
    processSettlementController,
    listRefundsController,
    getRefundsByOrderController
} from './payment.controller.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendError } from '../../utils/response.js';
import { Order } from '../../modules/commerce/orders/models/order.model.js';

const router = express.Router();

// This router is mounted behind authMiddleware alone, so every route below must say
// who may call it. Without these guards any logged-in customer could run settlements
// and read any seller's or rider's wallet by putting their id in the URL.

/** Order money trails are visible to the order's customer, seller, rider, and admins. */
const requireOrderParty = async (req, res, next) => {
    try {
        const { role, userId } = req.user || {};
        if (role === 'ADMIN') return next();
        const { orderId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
            return sendError(res, 404, 'Order not found');
        }
        const order = await Order.findById(orderId)
            .select('userId sellerId dispatch.deliveryPartnerId')
            .lean();
        const partyId = {
            USER: order?.userId,
            SELLER: order?.sellerId,
            DELIVERY_PARTNER: order?.dispatch?.deliveryPartnerId
        }[role];
        if (!order || !partyId || String(partyId) !== String(userId)) {
            return sendError(res, 404, 'Order not found');
        }
        return next();
    } catch (err) {
        return next(err);
    }
};

/** A seller or rider may only read their own wallet; admins may read any. */
const requireSelfOrAdmin = (role, param) => (req, res, next) => {
    if (req.user?.role === 'ADMIN') return next();
    if (req.user?.role === role && String(req.params[param]) === String(req.user.userId)) return next();
    return sendError(res, 403, 'Forbidden: insufficient permissions');
};

// ─── Payment history for an order (user sees their payment trail) ───
router.get('/orders/:orderId/payments', requireOrderParty, getPaymentHistoryController);
router.get('/orders/:orderId/transactions', requireOrderParty, getOrderTransactionsController);
router.get('/orders/:orderId/refunds', requireOrderParty, getRefundsByOrderController);

// ─── User wallet (new transaction-based endpoints) ───
router.get('/wallet/balance', getUserWalletBalanceController);
router.get('/wallet/transactions', getUserWalletTransactionsController);

// ─── Seller wallet ───
router.get('/seller/:sellerId/wallet', requireSelfOrAdmin('SELLER', 'sellerId'), getSellerWalletController);

// ─── Delivery partner wallet ───
router.get('/delivery/:deliveryPartnerId/wallet', requireSelfOrAdmin('DELIVERY_PARTNER', 'deliveryPartnerId'), getDeliveryWalletController);

// ─── Admin / Finance ───
router.use('/admin', requireRoles('ADMIN'));
router.get('/admin/wallet', getAdminWalletController);
router.get('/admin/finance/summary', getAdminFinanceSummaryController);
router.get('/admin/settlements', listSettlementsController);
router.post('/admin/settlements', createSettlementController);
router.post('/admin/settlements/:id/process', processSettlementController);
router.get('/admin/refunds', listRefundsController);

export default router;
