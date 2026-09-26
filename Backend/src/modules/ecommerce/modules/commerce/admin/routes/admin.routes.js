import express from 'express';
import * as paymentController from '../../../../core/payments/payment.controller.js';
import * as attributeController from '../controllers/attribute.controller.js';
import { AuthError } from '../../../../core/auth/errors.js';
import * as adminController from '../controllers/admin.controller.js';
import * as productApprovalController from '../controllers/productApproval.controller.js';
import * as adminInventoryController from '../controllers/adminInventory.controller.js';
import * as businessSettingsController from '../controllers/businessSettings.controller.js';
import * as feedbackExperienceController from '../controllers/feedbackExperience.controller.js';
import * as notificationBroadcastController from '../controllers/notificationBroadcast.controller.js';
import * as subscriptionBillingController from '../controllers/subscriptionBilling.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { listUserCartsAdminController, getUserCartPricingAdminController } from '../controllers/userCartAdmin.controller.js';
import { getAdminPageController, upsertAdminPageController } from '../controllers/pageContent.controller.js';
import { upload } from '../../../../middleware/upload.js';
import { invalidateCache } from '../../../../middleware/cache.js';
import {
    downloadBulkMenuTemplateController,
    uploadAdminBulkMenuController,
} from '../../seller/controllers/bulkUpload.controller.js';
import { Admin } from '../../../../core/admin/admin.model.js';
import { requireAdminPermission, requireAnyAdminPermission } from '../../../../core/roles/adminPermission.middleware.js';
import * as driverRegField from '../../delivery/controllers/driverRegistrationField.controller.js';
import * as cashbackSettings from '../controllers/cashbackSettings.controller.js';
import * as sellerAppBanner from '../controllers/sellerAppBanner.controller.js';
import * as coinController from '../../coins/controllers/coin.controller.js';
import * as spinController from '../../spin/controllers/spin.controller.js';
import * as dailyMetricsController from '../controllers/dailyMetrics.controller.js';
import * as reportsController from '../controllers/reports.controller.js';
import shipmentReturnAdminRoutes from '../../orders/routes/shipmentReturn.admin.routes.js';
import { pushCampaignAdminRoutes, firstOrderGuardAdminRoutes } from '../../campaigns/routes/pushCampaign.admin.routes.js';
import aiAdminRoutes from '../../ai/routes/aiAdmin.routes.js';
import courierOpsAdminRoutes from '../../orders/routes/courierOps.admin.routes.js';
import { adminReviewRoutes } from '../../reviews/routes/productReview.routes.js';
import {
    getAdminQuickHomeController,
    resetAdminQuickHomeController,
    saveAdminQuickHomeController,
} from '../../landing/controllers/quickHomeLayout.controller.js';

const router = express.Router();

// Public reads of these settings are served under /v1/settings.

const requireAdmin = (req, _res, next) => {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
        return next(new AuthError('Admin access required'));
    }
    return next();
};

router.use(requireAdmin);
router.use(async (req, _res, next) => {
    try {
        const admin = await Admin.findById(req.user?.userId)
            .select('adminType permissions isActive isDeleted')
            .lean();
        req.adminAccess = admin;
        return next();
    } catch (error) {
        return next(error);
    }
});

const resolveSectionFromRequest = (path = '', method = '') => {
    if (path.startsWith('/sub-admins')) return 'sub_admin_management';
    if (path === '/customers' && String(method).toUpperCase() === 'GET') return null;
    if (path.startsWith('/customers') || path.startsWith('/support-tickets')) return 'customer_management';
    if (path === '/zones' && String(method).toUpperCase() === 'GET') return null;
    if (/^\/zones\/[^/]+$/.test(path) && String(method).toUpperCase() === 'GET') return null;
    if (path === '/sellers' && String(method).toUpperCase() === 'GET') return null;
    if (/^\/sellers\/[^/]+$/.test(path) && String(method).toUpperCase() === 'GET') return null;
    if (/^\/sellers\/[^/]+\/analytics$/.test(path) && String(method).toUpperCase() === 'GET') return null;
    if (path === '/orders' && String(method).toUpperCase() === 'GET') return null;
    if (path === '/orders/user-carts' && String(method).toUpperCase() === 'GET') return null;
    if (
        path.startsWith('/sellers') ||
        path.startsWith('/seller-settings') ||
        path.startsWith('/seller-subscription-settings') ||
        path.startsWith('/seller-subscriptions') ||
        path.startsWith('/zones')
    ) return 'seller_management';
    if (
        path.startsWith('/categories') ||
        path.startsWith('/products') ||
        path.startsWith('/attributes') ||
        path.startsWith('/attribute-sets') ||
        path.startsWith('/product-reviews') ||
        path.startsWith('/inventory')
    ) return 'product_management';
    if (path.startsWith('/offers') || path.startsWith('/spin') || path.startsWith('/push-campaigns') || path.startsWith('/first-order-guard')) return 'promotions_management';
    if (path.startsWith('/orders') || path.startsWith('/order-detect-delivery')) return 'order_management';
    if (path.startsWith('/shipments') || path.startsWith('/returns') || path.startsWith('/checkouts')) return 'order_management';
    if (path.startsWith('/cod-remittances')) return 'report_management';
    if (path.startsWith('/delivery')) return 'delivery_management';
    if (path.startsWith('/withdrawals') || path.startsWith('/coins')) return 'transaction_management';
    if (path.startsWith('/feedback-experiences')) return 'report_management';
    if (path.startsWith('/reports')) return 'report_management';
    if (path.startsWith('/ai/')) return 'system_settings';
    if (path.startsWith('/feature-settings') || path.startsWith('/business-settings') || path.startsWith('/power-scanning') || path.startsWith('/notifications')) return 'system_settings';
    if (path.startsWith('/pages-social-media')) return 'pages_social_media';
    if (path.startsWith('/quick-home-layout')) return 'banner_management';
    if (path.startsWith('/sidebar-badges') || path.startsWith('/dashboard-stats')) return 'dashboard';
    return null;
};

const resolveActionByMethod = (method = '') => {
    const normalized = String(method).toUpperCase();
    if (normalized === 'GET') return 'view';
    if (normalized === 'POST') return 'create';
    if (normalized === 'DELETE') return 'delete';
    if (normalized === 'PATCH' || normalized === 'PUT') return 'edit';
    return 'view';
};

router.use((req, res, next) => {
    const section = resolveSectionFromRequest(req.path, req.method);
    if (!section) return next();
    const action = resolveActionByMethod(req.method);
    return requireAdminPermission(section, action)(req, res, next);
});

router.use('/sub-admins', requireAdminPermission('sub_admin_management', 'view'));
router.use(
    '/customers',
    requireAnyAdminPermission([
        { section: 'customer_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ])
);
router.use('/support-tickets', requireAdminPermission('customer_management', 'view'));
router.use('/seller-settings', requireAdminPermission('seller_management', 'view'));
router.use('/seller-subscription-settings', requireAdminPermission('seller_management', 'view'));
router.use('/seller-subscriptions', requireAdminPermission('seller_management', 'view'));
router.use('/categories', requireAdminPermission('product_management', 'view'));
router.use('/products', requireAdminPermission('product_management', 'view'));
router.use('/offers', requireAdminPermission('promotions_management', 'view'));
router.use('/delivery', requireAdminPermission('delivery_management', 'view'));
router.use('/withdrawals', requireAdminPermission('transaction_management', 'view'));
router.use('/reports', requireAdminPermission('report_management', 'view'));
router.use('/feature-settings', requireAdminPermission('system_settings', 'view'));
router.use('/business-settings', requireAdminPermission('system_settings', 'view'));
router.use('/power-scanning', requireAdminPermission('system_settings', 'view'));
router.use('/notifications', requireAdminPermission('system_settings', 'view'));
router.use('/ai', requireAdminPermission('system_settings', 'view'), aiAdminRoutes);
router.use('/pages-social-media', requireAdminPermission('pages_social_media', 'view'));
router.use('/sidebar-badges', requireAdminPermission('dashboard', 'view'));

router.post('/sub-admins', requireAdminPermission('sub_admin_management', 'create'), adminController.createSubAdmin);
router.get('/sub-admins', adminController.listSubAdmins);
router.get('/sub-admins/permission-catalog', adminController.getAdminPermissionCatalog);
router.get('/sub-admins/:id', adminController.getSubAdminDetails);
router.patch('/sub-admins/:id', requireAdminPermission('sub_admin_management', 'edit'), adminController.updateSubAdminProfile);
router.patch('/sub-admins/:id/permissions', requireAdminPermission('sub_admin_management', 'edit'), adminController.updateSubAdminPermissions);
router.patch('/sub-admins/:id/status', requireAdminPermission('sub_admin_management', 'edit'), adminController.updateSubAdminStatus);
router.delete('/sub-admins/:id', requireAdminPermission('sub_admin_management', 'delete'), adminController.deleteSubAdmin);

// ----- Broadcast Notifications -----
router.post('/notifications/broadcast', notificationBroadcastController.createBroadcastNotificationController);
router.get('/notifications/broadcast', notificationBroadcastController.getBroadcastNotificationsController);
router.delete('/notifications/broadcast/:id', notificationBroadcastController.deleteBroadcastNotificationController);

// ----- Customers -----
router.get(
    '/customers',
    requireAnyAdminPermission([
        { section: 'customer_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ]),
    adminController.getCustomers
);
router.get('/customers/:id', adminController.getCustomerById);
router.patch('/customers/:id/status', adminController.updateCustomerStatus);

// ----- Safety / Emergency Reports -----
router.get('/safety-emergency-reports', adminController.getSafetyEmergencyReports);
router.put('/safety-emergency-reports/:id/status', adminController.updateSafetyEmergencyStatus);
router.put('/safety-emergency-reports/:id/priority', adminController.updateSafetyEmergencyPriority);
router.delete('/safety-emergency-reports/:id', adminController.deleteSafetyEmergencyReport);

// ----- Support Tickets (users) -----
router.get('/support-tickets/stats', adminController.getUserSupportTicketStatsController);
router.get('/support-tickets', adminController.getSupportTicketsController);
router.patch('/support-tickets/:id', adminController.updateSupportTicketController);
router.get('/global-search', adminController.globalSearch);
router.get('/sellers/complaints/stats', adminController.getSellerComplaintStatsController);
router.get('/sellers/complaints', adminController.getSellerComplaints);
router.patch('/sellers/complaints/:id', adminController.updateSellerComplaint);

// ----- Sellers -----
router.get(
    '/sellers',
    requireAnyAdminPermission([
        { section: 'seller_management', action: 'view' },
        { section: 'point_of_sale', action: 'view' },
        { section: 'report_management', action: 'view' },
        { section: 'banner_management', action: 'view' },
    ]),
    adminController.getSellers
);
router.get('/dashboard-stats', adminController.getDashboardStats);
router.get('/reports/sellers', adminController.getSellerReport);
router.get('/reports/transactions', adminController.getTransactionReport);
router.get('/reports/tax', adminController.getTaxReport);
router.get('/reports/payments/reconciliation', paymentController.getPaymentReconciliationController);
router.get('/reports/tax/:id', adminController.getTaxReportDetail);
router.get('/reports/delivery-sla', reportsController.getDeliverySlaReportController);
router.get('/reports/delivery-sla/export', reportsController.exportDeliverySlaReportController);
router.get('/reports/commission', reportsController.getCommissionReportController);
router.get('/reports/commission/export', reportsController.exportCommissionReportController);
router.get('/reports/coin-liability', reportsController.getCoinLiabilityReportController);
router.get('/reports/coin-liability/export', reportsController.exportCoinLiabilityReportController);
router.get('/sellers/pending', adminController.getPendingSellers);
router.get('/sellers/unregistered', adminController.getUnregisteredSellers);
router.delete('/sellers/unregistered/:id', adminController.deleteUnregisteredSeller);
router.get('/seller-subscription-settings', adminController.getSellerSubscriptionSettings);
router.patch('/seller-subscription-settings', adminController.updateSellerSubscriptionSettings);
router.get('/seller-subscriptions/history', adminController.getSellerSubscriptionHistory);
// Calendar-month postpaid billing (invoices, settlement actions, analytics)
router.get('/seller-subscriptions/invoices', subscriptionBillingController.listSubscriptionInvoices);
router.get('/seller-subscriptions/invoices/export', subscriptionBillingController.exportSubscriptionInvoices);
router.get('/seller-subscriptions/invoices/:invoiceId', subscriptionBillingController.getSubscriptionInvoice);
router.get('/seller-subscriptions/summary', subscriptionBillingController.getSubscriptionBillingSummary);
router.get('/seller-subscriptions/sellers/:sellerId/overview', subscriptionBillingController.getSellerSubscriptionOverview);
router.post('/seller-subscriptions/invoices/:invoiceId/deduct-wallet', subscriptionBillingController.deductInvoiceFromWallet);
router.post('/seller-subscriptions/invoices/:invoiceId/mark-paid', subscriptionBillingController.markInvoicePaid);
router.post('/seller-subscriptions/invoices/:invoiceId/waive', subscriptionBillingController.waiveInvoice);
router.post('/seller-subscriptions/invoices/:invoiceId/adjust', subscriptionBillingController.adjustInvoice);
router.post('/seller-subscriptions/run-billing', subscriptionBillingController.runSubscriptionBilling);
router.get('/feature-settings', adminController.getFeatureSettings);
router.patch('/feature-settings/:key', adminController.updateFeatureSetting);
router.get('/sellers/reviews', adminController.getSellerReviews);
router.get(
    '/sellers/:id',
    requireAnyAdminPermission([
        { section: 'seller_management', action: 'view' },
        { section: 'point_of_sale', action: 'view' },
        { section: 'report_management', action: 'view' },
        { section: 'banner_management', action: 'view' },
    ]),
    adminController.getSellerById
);
router.get(
    '/sellers/:id/analytics',
    requireAnyAdminPermission([
        { section: 'seller_management', action: 'view' },
        { section: 'point_of_sale', action: 'view' },
        { section: 'report_management', action: 'view' },
        { section: 'banner_management', action: 'view' },
    ]),
    adminController.getSellerAnalytics
);
router.post('/sellers', adminController.createSeller);
router.patch('/sellers/:id', adminController.updateSellerById);
router.patch('/sellers/:id/status', adminController.updateSellerStatus);
router.patch('/sellers/:id/location', adminController.updateSellerLocation);
router.patch('/sellers/:id/approve', adminController.approveSeller);
router.patch('/sellers/:id/reject', adminController.rejectSeller);
router.patch('/sellers/:id/channels/:channel', adminController.decideSellerChannel);
router.delete('/sellers/:id', adminController.deleteSeller);


// ----- Seller Commission -----
router.get('/seller-commissions/bootstrap', adminController.getSellerCommissionBootstrap);
router.get('/seller-commissions', adminController.getSellerCommissions);
router.post('/seller-commissions', adminController.createSellerCommission);
router.get('/seller-commissions/:id', adminController.getSellerCommissionById);
router.patch('/seller-commissions/:id', adminController.updateSellerCommission);
router.delete('/seller-commissions/:id', adminController.deleteSellerCommission);
router.patch('/seller-commissions/:id/toggle', adminController.toggleSellerCommissionStatus);

// ----- Categories -----
// Attributes (Size, Color...) and the sets categories use.
router.get('/attributes', attributeController.listAttributesController);
router.post('/attributes', attributeController.createAttributeController);
router.patch('/attributes/:id', attributeController.updateAttributeController);
router.delete('/attributes/:id', attributeController.deleteAttributeController);
router.get('/attribute-sets', attributeController.listAttributeSetsController);
router.post('/attribute-sets', attributeController.createAttributeSetController);
router.patch('/attribute-sets/:id', attributeController.updateAttributeSetController);
router.delete('/attribute-sets/:id', attributeController.deleteAttributeSetController);

router.get('/categories', adminController.getCategories);
router.post('/categories', adminController.createCategory);
router.patch('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);
router.patch('/categories/:id/toggle', adminController.toggleCategoryStatus);
router.patch('/categories/:id/approve', adminController.approveCategory);
router.patch('/categories/:id/reject', adminController.rejectCategory);
router.patch('/categories/:id/make-global', adminController.makeCategoryGlobal);

// ----- Products -----
router.get('/products', adminController.getProducts);
router.get('/products/bulk-upload/template', downloadBulkMenuTemplateController);
router.post('/products/bulk-upload', upload.single('file'), uploadAdminBulkMenuController);
router.post('/products/bulk-delete', adminController.bulkDeleteProducts);
/**
 * Drops the cached customer-facing menus after any admin change to a dish.
 *
 * The public feed is cached for 5 minutes and each seller menu for 10, and
 * nothing on the admin side was clearing them. An admin edited a dish, refreshed
 * the app, saw no change, and edited it again — the write had always worked, the
 * customer was simply being served a stale copy. The seller-side menu routes
 * already do this; the admin ones were missed.
 */
const invalidatePublicMenus = async (_req, _res, next) => {
    try {
        await invalidateCache('seller_menu:*');
        await invalidateCache('public_products:*');
    } catch (_) {
        // A cache that will not clear must not fail the write itself; the entry
        // expires on its own within the TTL.
    }
    next();
};

router.post('/products', invalidatePublicMenus, adminController.createProduct);
router.patch('/products/:id', invalidatePublicMenus, adminController.updateProduct);
router.delete('/products/:id', invalidatePublicMenus, adminController.deleteProduct);
// Product approval queue (pending items created by sellers)
router.get('/products/pending-approvals', productApprovalController.getPendingProductApprovals);
router.patch('/products/:id/approve', productApprovalController.approveProductController);
router.patch('/products/:id/reject', productApprovalController.rejectProductController);
router.post('/products/bulk-approve', adminController.bulkApproveProducts);
// Low stock per channel (admin panel). Same permission as the product pages.
router.get('/inventory/low-stock', requireAdminPermission('product_management', 'view'), adminInventoryController.getLowStock);


// ----- Offers & Coupons -----
router.get('/offers', adminController.getAllOffers);
router.post('/offers', adminController.createAdminOffer);
router.patch('/offers/:id/cart-visibility', adminController.updateAdminOfferCartVisibility);
router.delete('/offers/:id', adminController.deleteAdminOffer);

// ----- Feedback Experience (Admin) -----
router.get('/feedback-experiences', feedbackExperienceController.getFeedbackExperiences);
router.delete('/feedback-experiences/:id', feedbackExperienceController.deleteFeedbackExperience);

// ----- Fee Settings -----
router.get('/fee-settings', adminController.getFeeSettings);
router.put('/fee-settings', adminController.createOrUpdateFeeSettings);

// ----- Driver Registration Fields (dynamic form builder) -----
router.get('/driver-registration-fields', driverRegField.listFieldsController);
router.post('/driver-registration-fields', driverRegField.createFieldController);
router.patch('/driver-registration-fields/:id', driverRegField.updateFieldController);
router.delete('/driver-registration-fields/:id', driverRegField.deleteFieldController);

// ----- Seller App Promo Banners (shown inside the seller partner app) -----
router.get('/seller-app-banners', sellerAppBanner.listBannersAdminController);
router.post('/seller-app-banners', upload.single('file'), sellerAppBanner.createBannerController);
router.patch('/seller-app-banners/order', sellerAppBanner.reorderBannersController);
router.patch('/seller-app-banners/:id/status', sellerAppBanner.toggleBannerStatusController);
router.patch('/seller-app-banners/:id', upload.single('file'), sellerAppBanner.updateBannerController);
router.delete('/seller-app-banners/:id', sellerAppBanner.deleteBannerController);

// ----- Cashback Settings -----
router.get('/cashback-settings', cashbackSettings.getCashbackSettingsController);
router.put('/cashback-settings', cashbackSettings.upsertCashbackSettingsController);

// ----- Referral Settings -----
router.get('/referral-settings', adminController.getReferralSettings);
router.put('/referral-settings', adminController.createOrUpdateReferralSettings);

// ----- Business Settings -----
router.get('/business-settings', businessSettingsController.getBusinessSettings);
router.patch('/business-settings', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'sellerLogo', maxCount: 1 },
    { name: 'sellerFavicon', maxCount: 1 },
    { name: 'deliveryLogo', maxCount: 1 },
    { name: 'deliveryFavicon', maxCount: 1 }
]), businessSettingsController.updateBusinessSettings);
router.get('/power-scanning', businessSettingsController.getPowerScanningSettings);
router.patch('/power-scanning', businessSettingsController.updatePowerScanningSettings);

// ----- Seller Settings -----
router.get('/seller-settings/order-acceptance', businessSettingsController.getOrderAcceptanceSettings);
router.patch('/seller-settings/order-acceptance', businessSettingsController.updateOrderAcceptanceSettings);

// ----- Delivery Cash Limit -----
router.get('/delivery-cash-limit', adminController.getDeliveryCashLimit);
router.patch('/delivery-cash-limit', adminController.updateDeliveryCashLimit);

// ----- Delivery Emergency Help -----
router.get('/delivery-emergency-help', adminController.getEmergencyHelp);
router.put('/delivery-emergency-help', adminController.createOrUpdateEmergencyHelp);

// ----- Withdrawals (admin) -----
router.get('/withdrawals', adminController.getWithdrawals);
router.patch('/withdrawals/:id', adminController.updateWithdrawalStatus);
router.get('/delivery/withdrawals', adminController.getDeliveryWithdrawals);
router.patch('/delivery/withdrawals/:id', adminController.updateDeliveryWithdrawalStatus);
router.get('/delivery/cash-limit-settlements', adminController.getCashLimitSettlements);

// ----- Delivery partners & general -----
router.get('/delivery/join-requests', adminController.getDeliveryJoinRequests);
router.get('/delivery/wallets', adminController.getDeliveryWallets);
router.patch('/delivery/wallets', adminController.updateDeliveryBoyWallet);
router.get('/delivery/bonus-transactions', adminController.getDeliveryPartnerBonusTransactions);
router.get('/delivery/earnings', adminController.getDeliveryEarnings);
router.post('/delivery/bonus', adminController.addDeliveryPartnerBonus);
router.get('/delivery/commission-rules', adminController.getDeliveryCommissionRules);
router.post('/delivery/commission-rules', adminController.createDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id', adminController.updateDeliveryCommissionRule);
router.delete('/delivery/commission-rules/:id', adminController.deleteDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id/status', adminController.toggleDeliveryCommissionRuleStatus);
router.get('/delivery/reviews', adminController.getDeliverymanReviews);
router.get('/contact-messages', adminController.getContactMessages);
router.get('/delivery/earning-addons', adminController.getEarningAddons);
router.post('/delivery/earning-addons', adminController.createEarningAddon);
router.patch('/delivery/earning-addons/:id', adminController.updateEarningAddon);
router.delete('/delivery/earning-addons/:id', adminController.deleteEarningAddon);
router.patch('/delivery/earning-addons/:id/status', adminController.toggleEarningAddonStatus);
router.get('/delivery/earning-addon-history', adminController.getEarningAddonHistory);
router.post('/delivery/earning-addon-history/:id/credit', adminController.creditEarningToWallet);
router.post('/delivery/earning-addon-history/:id/cancel', adminController.cancelEarningAddonHistory);
router.post('/delivery/earning-addon-completions/check', adminController.checkEarningAddonCompletions);
router.get('/delivery/support-tickets/stats', adminController.getSupportTicketStats);
router.get('/delivery/support-tickets', adminController.getSupportTickets);
router.patch('/delivery/support-tickets/:id', adminController.updateSupportTicket);
router.get('/delivery/order-emergency-requests', adminController.getOrderEmergencyRequests);
router.get('/delivery/order-emergency-requests/:id', adminController.getOrderEmergencyRequest);
router.patch('/delivery/order-emergency-requests/:id', adminController.updateOrderEmergencyRequest);
router.patch(
    '/delivery/order-emergency-requests/:id/deassign-resend',
    requireAdminPermission('delivery_management', 'edit'),
    adminController.deassignAndResendOrderEmergencyRequest
);
router.get('/delivery/partners', adminController.getDeliveryPartners);
router.get('/delivery/:id', adminController.getDeliveryPartnerById);
router.patch('/delivery/:id/approve', adminController.approveDeliveryPartner);
router.patch('/delivery/:id/reject', adminController.rejectDeliveryPartner);
router.patch(
    '/delivery/:id',
    requireAdminPermission('delivery_management', 'edit'),
    adminController.updateDeliveryPartnerProfile
);
router.delete('/delivery/:id', adminController.deleteDeliveryPartner);

// ----- Zones -----
router.get(
    '/zones',
    requireAnyAdminPermission([
        { section: 'dashboard', action: 'view' },
        { section: 'seller_management', action: 'view' },
        { section: 'point_of_sale', action: 'view' },
        { section: 'product_management', action: 'view' },
        { section: 'delivery_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ]),
    adminController.getZones
);
router.get(
    '/zones/:id',
    requireAnyAdminPermission([
        { section: 'dashboard', action: 'view' },
        { section: 'seller_management', action: 'view' },
        { section: 'point_of_sale', action: 'view' },
        { section: 'product_management', action: 'view' },
        { section: 'delivery_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ]),
    adminController.getZoneById
);
router.post('/zones', adminController.createZone);

// Quick phone home layout (QUICK_MOBILE_SPEC.md §3): ?zoneId= targets a zone,
// none targets the global layout every zone falls back to.
router.get('/quick-home-layout', getAdminQuickHomeController);
router.put('/quick-home-layout', saveAdminQuickHomeController);
router.delete('/quick-home-layout', resetAdminQuickHomeController);
router.patch('/zones/:id', adminController.updateZone);
router.delete('/zones/:id', adminController.deleteZone);

// ----- Orders -----
router.get(
    '/orders',
    requireAnyAdminPermission([
        { section: 'order_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ]),
    orderController.listOrdersAdminController
);
router.get(
    '/orders/user-carts',
    requireAnyAdminPermission([
        { section: 'order_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ]),
    listUserCartsAdminController
);
router.get(
    '/orders/user-carts/:cartId/pricing',
    requireAnyAdminPermission([
        { section: 'order_management', action: 'view' },
        { section: 'report_management', action: 'view' },
    ]),
    getUserCartPricingAdminController
);
router.get('/orders/:orderId', orderController.getOrderByIdAdminController);
router.patch('/orders/:orderId/accept', orderController.acceptOrderAdminController);
router.patch('/orders/:orderId/reject', orderController.rejectOrderAdminController);
router.patch(
    '/orders/:orderId/mark-delivered',
    requireAdminPermission('order_management', 'edit'),
    orderController.markOrderDeliveredAdminController
);
router.patch(
    '/orders/:orderId/deassign-resend',
    requireAdminPermission('order_management', 'edit'),
    adminController.deassignAndResendOrder
);
router.post(
    '/orders/:orderId/resend-notification',
    requireAdminPermission('order_management', 'edit'),
    orderController.resendDeliveryNotificationAdminController
);
router.post('/orders/:orderId/refund', orderController.processRefundAdminController);
router.delete('/orders/:orderId', orderController.deleteOrderAdminController);

// ----- Courier shipments and returns (Shop panel) -----
router.use(courierOpsAdminRoutes);
router.use(shipmentReturnAdminRoutes);

// ----- CMS Pages (About + legal) -----
router.get('/pages-social-media/:key', getAdminPageController);
router.put('/pages-social-media/:key', upsertAdminPageController);

router.get('/sidebar-badges', adminController.getSidebarBadges);
router.get('/notifications/fssai-expired', adminController.getExpiredFssaiNotifications);

// ----- Platform Coins (Promotional liability ledger & settings) -----
// ----- Spin wheel -----
router.use('/push-campaigns', pushCampaignAdminRoutes);
router.post('/first-order-guard/claims/:id/release', adminInventoryController.releaseFirstOrderClaim);
router.use('/first-order-guard', firstOrderGuardAdminRoutes);
// Product review moderation (section product_management: GET view, PATCH edit, DELETE delete).
router.use('/product-reviews', adminReviewRoutes);
router.get('/spin/campaigns', spinController.listSpinCampaignsController);
router.post('/spin/campaigns', spinController.createSpinCampaignController);
router.patch('/spin/campaigns/:id', spinController.updateSpinCampaignController);
router.patch('/spin/campaigns/:id/active', spinController.setSpinCampaignActiveController);
router.get('/spin/report', spinController.getSpinReportController);

router.get('/coins/settings', coinController.getCoinSettingsController);
router.patch('/coins/settings', coinController.updateCoinSettingsController);
router.post('/coins/adjust', coinController.adjustCoinsController);
router.get('/coins/report', coinController.getCoinReportController);
router.get('/coins/users/:userId/ledger', coinController.getUserCoinLedgerAdminController);

// ----- Daily Metrics & Precomputed Analytics -----
router.get('/analytics/daily-metrics', dailyMetricsController.getDailyMetricsController);
router.get('/analytics/fulfillment-summary', dailyMetricsController.getFulfillmentSummaryController);
router.post('/analytics/daily-metrics/aggregate', dailyMetricsController.triggerDailyMetricsAggregationController);

export default router;
