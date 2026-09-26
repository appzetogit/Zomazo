// E-commerce module router.
//
// Mounted by the platform at /api/v1/ecom, so every path below is relative to
// that. As a standalone app these sat at /v1/* -- the prefix is stripped rather
// than kept, since /v1/orders, /v1/user and /v1/admin already mean something
// else at the platform level.
//
// Not mounted, on purpose (the code is still in the tree):
//   /delivery      -- this vertical ships by courier; the platform owns riders.
//   /ai, /chat     -- later; not in the first release.
//   /notifications/opened -- push campaigns are later too.
//

import express from 'express';
import authRoutes from '../core/auth/auth.routes.js';
import sellerRoutes from '../modules/commerce/seller/routes/seller.routes.js';
import landingRoutes from '../modules/commerce/landing/routes/landing.routes.js';
import uploadRoutes from '../modules/uploads/routes/upload.routes.js';
import adminRoutes from '../modules/commerce/admin/routes/admin.routes.js';
import userRoutes from '../modules/commerce/user/routes/user.routes.js';
import orderUserRoutes from '../modules/commerce/orders/routes/order.routes.user.js';
import paymentRoutes from '../core/payments/payment.routes.js';
import fcmRoutes from '../core/notifications/fcm.routes.js';
import notificationRoutes from '../core/notifications/notification.routes.js';
import { authMiddleware } from '../core/auth/auth.middleware.js';
import * as businessSettingsController from '../modules/commerce/admin/controllers/businessSettings.controller.js';
import * as adminController from '../modules/commerce/admin/controllers/admin.controller.js';
import { requireRoles } from '../core/roles/role.middleware.js';
import { getQueuesController } from '../controllers/admin.controller.js';
import catalogRoutes from '../modules/commerce/catalog/routes/catalog.routes.js';
import { getCashbackSettingsPublicController } from '../modules/commerce/user/controllers/cashback.controller.js';
// Platform-level vertical gate: a platform admin reaches this panel only when
// their servicesAccess names e-commerce.
import { requireServiceAccess } from '../../../core/roles/serviceAccess.middleware.js';

const router = express.Router();

router.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// Sellers sign in here. Customers sign in on the platform and are bridged by
// authMiddleware; admins sign in on the platform panel.
router.use('/auth', authRoutes);
router.use('/uploads', uploadRoutes);

// Anyone browsing, signed in or not.
router.use('/catalog', catalogRoutes);
router.use('/content', landingRoutes);
router.get('/settings/business', businessSettingsController.getBusinessSettings);
router.get('/settings/power-scanning', businessSettingsController.getPowerScanningSettings);
router.get('/settings/seller-subscription', adminController.getSellerSubscriptionSettings);
router.get('/settings/features', adminController.getFeatureSettings);
router.get('/settings/fees', adminController.getFeeSettings);
router.get('/settings/cashback', getCashbackSettingsPublicController);

// Customers.
router.use('/user', authMiddleware, requireRoles('USER'), userRoutes);
router.use('/orders', authMiddleware, requireRoles('USER'), orderUserRoutes);

// Payments. There is deliberately no /payments/webhook here: Razorpay delivers
// each event to ONE url, the platform's /v1/payments/webhook/razorpay, which
// hands e-commerce events to core/payments/controllers/razorpayWebhook.controller.js
// in this module.
router.use('/payments', authMiddleware, paymentRoutes);

// Sellers; the router guards its own routes.
router.use('/seller', sellerRoutes);

router.use('/notifications', authMiddleware, requireRoles('USER', 'SELLER'), notificationRoutes);
router.use('/fcm-tokens', fcmRoutes);

// Admin. The queue view is registered first so the admin router's section
// permissions never see it.
router.get('/admin/queues', authMiddleware, requireRoles('ADMIN'), requireServiceAccess('ecommerce'), getQueuesController);
router.use('/admin', authMiddleware, requireRoles('ADMIN'), requireServiceAccess('ecommerce'), adminRoutes);

export default router;
