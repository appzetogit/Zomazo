import express from 'express';
import authRoutes from '../core/auth/auth.routes.js';
import deliveryRoutes from '../modules/commerce/delivery/routes/delivery.routes.js';
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
import webhookRoutes from '../core/payments/routes/webhook.routes.js';
import catalogRoutes from '../modules/commerce/catalog/routes/catalog.routes.js';
import chatRoutes from '../modules/commerce/chat/routes/chat.routes.js';
import aiRoutes from '../modules/commerce/ai/routes/ai.routes.js';
import { getCashbackSettingsPublicController } from '../modules/commerce/user/controllers/cashback.controller.js';
import { config } from '../config/env.js';
import { getRateLimitSummary } from '../middleware/rateLimit.js';
import { recordOpen as recordCampaignPushOpen } from '../modules/commerce/campaigns/controllers/pushCampaign.controller.js';

const router = express.Router();

router.get('/v1/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

if (config.nodeEnv !== 'production') {
    router.get('/v1/health/rate-limit', (_req, res) => {
        res.status(200).json({ success: true, data: getRateLimitSummary() });
    });
}

// Paths are grouped by who calls them, not by business line: quick and standard
// delivery share these, told apart by parameters rather than separate trees.

router.use('/v1/auth', authRoutes);
router.use('/v1/uploads', uploadRoutes);

// Anyone browsing, signed in or not.
router.use('/v1/catalog', catalogRoutes);
router.use('/v1/content', landingRoutes);
router.use('/v1/ai', aiRoutes);
router.get('/v1/settings/business', businessSettingsController.getBusinessSettings);
router.get('/v1/settings/power-scanning', businessSettingsController.getPowerScanningSettings);
router.get('/v1/settings/seller-subscription', adminController.getSellerSubscriptionSettings);
router.get('/v1/settings/features', adminController.getFeatureSettings);
router.get('/v1/settings/fees', adminController.getFeeSettings);
router.get('/v1/settings/cashback', getCashbackSettingsPublicController);

// Customers.
router.use('/v1/user', authMiddleware, requireRoles('USER'), userRoutes);
router.use('/v1/orders', authMiddleware, requireRoles('USER'), orderUserRoutes);

// Payments. The gateway's webhook is unauthenticated, so it is mounted before
// the authenticated router that shares its prefix.
router.use('/v1/payments/webhook', webhookRoutes);
router.use('/v1/payments', authMiddleware, paymentRoutes);

// Sellers and riders; each router guards its own routes.
router.use('/v1/seller', sellerRoutes);
router.use('/v1/delivery', deliveryRoutes);

// A campaign push was tapped. Unauthenticated (the push carries a signed open
// token), so it is registered before the signed-in notifications router.
router.post('/v1/notifications/opened', recordCampaignPushOpen);

// Shared by every signed-in role.
router.use('/v1/notifications', authMiddleware, requireRoles('USER', 'SELLER', 'DELIVERY_PARTNER'), notificationRoutes);
router.use('/v1/chat', authMiddleware, requireRoles('USER', 'SELLER', 'DELIVERY_PARTNER', 'ADMIN'), chatRoutes);
router.use('/v1/fcm-tokens', fcmRoutes);

// Admin. The queue view is registered first so the admin router's section
// permissions never see it.
router.get('/v1/admin/queues', authMiddleware, requireRoles('ADMIN'), getQueuesController);
router.use('/v1/admin', authMiddleware, requireRoles('ADMIN'), adminRoutes);

export default router;
