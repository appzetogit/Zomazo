import { resubmitController } from '../../shared/resubmitApplication.js';
import { Seller } from '../models/seller.model.js';
import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    registerSellerController,
    createOnboardingFeeOrderController,
    getCurrentSellerController,
    updateSellerProfileController,
    updateSellerAcceptingOrdersController,
    uploadSellerProfileImageController,
    uploadSellerMenuImageController,
    uploadSellerCoverImagesController,
    uploadSellerMenuImagesController,
    getSellerComplaintsController,
    uploadSellerAttachmentController,
    deleteCurrentSellerAccountController,
    registerUnregisteredSellerController,
    getSellerSubscriptionHistoryController,
    applyForChannelController
} from '../controllers/seller.controller.js';
import {
    createSellerOfferController,
    listSellerOffersController,
    deleteSellerOfferController,
    updateSellerOfferStatusController
} from '../controllers/sellerOffer.controller.js';
import {
    createSellerSupportTicketController,
    listSellerSupportTicketsController
} from '../controllers/supportTicket.controller.js';
import {
    createWithdrawalRequestController,
    listMyWithdrawalsController
} from '../controllers/withdrawal.controller.js';
import {
    getSubscriptionOverviewController,
    listSubscriptionInvoicesController,
    getSubscriptionInvoiceController,
    listSubscriptionTransactionsController
} from '../controllers/subscription.controller.js';
import {
    listCategoriesController,
    createCategoryController,
    updateCategoryController,
    deleteCategoryController
} from '../controllers/sellerCategory.controller.js';
import { getMenuController } from '../controllers/sellerMenu.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';
import {
    getCurrentSellerOutletTimingsController,
    upsertCurrentSellerOutletTimingsController
} from '../controllers/outletTimings.controller.js';
import {
    createSellerProductController,
    deleteSellerProductController,
    updateSellerProductController,
    updateSellerProductStockController,
    listLowStockProductsController,
    getAnalyticsController
} from '../controllers/sellerProduct.controller.js';
import {
    downloadBulkMenuTemplateController,
    uploadBulkMenuController
} from '../controllers/bulkUpload.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { listReturnsSellerController } from '../../orders/controllers/shipmentReturn.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { sellerReviewRoutes } from '../../reviews/routes/productReview.routes.js';
import { sendError } from '../../../../utils/response.js';
import { getSellerFinanceController } from '../controllers/sellerFinance.controller.js';
import {
    listBannersController,
    uploadBannersController,
    deleteBannerController,
    reorderBannersController,
    getMediaController,
    uploadCoverImageController,
    uploadGalleryImagesController,
    deleteGalleryImageController
} from '../controllers/sellerBanner.controller.js';
import { listBannersForSellerAppController } from '../../admin/controllers/sellerAppBanner.controller.js';

import { invalidateCache } from '../../../../middleware/cache.js';

const router = express.Router();

const requireSeller = (req, res, next) => {
    if (req.user?.role !== 'SELLER') {
        return sendError(res, 403, 'Store access required');
    }
    next();
};

const uploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'panImage', maxCount: 1 },
    { name: 'gstImage', maxCount: 1 },
    { name: 'fssaiImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 },
    // Onboarding: main cover + premises gallery (gallery is shown to the rider at pickup).
    { name: 'coverImage', maxCount: 1 },
    { name: 'galleryImages', maxCount: 10 }
]);

router.post('/register', uploadFields, registerSellerController);
router.post('/onboarding-fee/order', createOnboardingFeeOrderController);
router.post('/unregistered', registerUnregisteredSellerController);
router.post('/upload-attachment', upload.single('file'), uploadSellerAttachmentController);

// Public store and product reads live in the catalog router.

// Seller dashboard/profile (Bearer token + SELLER role)
router.get('/current', authMiddleware, requireSeller, getCurrentSellerController);
router.post('/reverify', authMiddleware, requireSeller, resubmitController(Seller));
router.post('/channels/:channel/apply', authMiddleware, requireSeller, applyForChannelController);
/**
 * Account deletion, initiated by the seller themselves.
 *
 * The controller has existed all along and was imported here, but never given
 * a route -- so the only way to close an account was to ask someone with
 * database access. Google Play and the App Store both require deletion to be
 * reachable from inside the app, which made this a submission blocker rather
 * than a missing convenience.
 */
router.delete('/current', authMiddleware, requireSeller, deleteCurrentSellerAccountController);
router.patch('/profile', authMiddleware, requireSeller, async (req, res, next) => {
    // Invalidate caches when profile is updated
    await invalidateCache('sellers:*');
    await invalidateCache('seller_detail:*');
    next();
}, updateSellerProfileController);
router.patch('/availability', authMiddleware, requireSeller, async (req, res, next) => {
    await invalidateCache('sellers:*');
    await invalidateCache('seller_detail:*');
    next();
}, updateSellerAcceptingOrdersController);

router.get('/outlet-timings', authMiddleware, requireSeller, getCurrentSellerOutletTimingsController);
router.put('/outlet-timings', authMiddleware, requireSeller, upsertCurrentSellerOutletTimingsController);
router.get('/finance', authMiddleware, requireSeller, getSellerFinanceController);
router.post('/withdraw', authMiddleware, requireSeller, createWithdrawalRequestController);
router.get('/withdrawals', authMiddleware, requireSeller, listMyWithdrawalsController);
router.get('/subscription-history', authMiddleware, requireSeller, getSellerSubscriptionHistoryController);
// New calendar-month postpaid subscription endpoints
router.get('/subscription/overview', authMiddleware, requireSeller, getSubscriptionOverviewController);
router.get('/subscription/invoices', authMiddleware, requireSeller, listSubscriptionInvoicesController);
router.get('/subscription/invoices/:invoiceId', authMiddleware, requireSeller, getSubscriptionInvoiceController);
router.get('/subscription/transactions', authMiddleware, requireSeller, listSubscriptionTransactionsController);
router.post(
    '/profile/profile-image',
    authMiddleware,
    requireSeller,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('sellers:*');
        await invalidateCache('seller_detail:*');
        next();
    },
    uploadSellerProfileImageController
);
router.post(
    '/profile/menu-image',
    authMiddleware,
    requireSeller,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('seller_menu:*');
        next();
    },
    uploadSellerMenuImageController
);
router.post(
    '/profile/cover-images',
    authMiddleware,
    requireSeller,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('seller_detail:*');
        next();
    },
    uploadSellerCoverImagesController
);
router.post(
    '/profile/menu-images',
    authMiddleware,
    requireSeller,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('seller_menu:*');
        next();
    },
    uploadSellerMenuImagesController
);

// Admin-managed promo banners shown INSIDE the seller partner app.
router.get('/app-banners', authMiddleware, requireSeller, listBannersForSellerAppController);

// Main cover image + premises gallery. The gallery is surfaced to the delivery partner
// at pickup so they can visually identify the shop.
router.get('/media', authMiddleware, requireSeller, getMediaController);
router.post('/media/cover-image', authMiddleware, requireSeller, upload.single('file'), uploadCoverImageController);
router.post('/media/gallery', authMiddleware, requireSeller, upload.array('files', 10), uploadGalleryImagesController);
router.delete('/media/gallery', authMiddleware, requireSeller, deleteGalleryImageController);

// Banners shown on the public seller page (/sellers/:id -> coverImages).
// Separate from /profile/cover-images, which resets the seller to 'pending' and is
// only appropriate during onboarding — routine banner edits must not take a live
// seller offline.
router.get('/banners', authMiddleware, requireSeller, listBannersController);
router.post(
    '/banners',
    authMiddleware,
    requireSeller,
    upload.array('files', 10),
    uploadBannersController
);
router.delete('/banners', authMiddleware, requireSeller, deleteBannerController);
router.patch('/banners/order', authMiddleware, requireSeller, reorderBannersController);

// Categories (seller dashboard). Read-only for item creation, CRUD for Menu Categories page.
router.get('/categories', authMiddleware, requireSeller, listCategoriesController);
router.post('/categories', authMiddleware, requireSeller, createCategoryController);
router.patch('/categories/:id', authMiddleware, requireSeller, updateCategoryController);
router.delete('/categories/:id', authMiddleware, requireSeller, deleteCategoryController);

// Menu (seller dashboard) - only fields needed by UI
router.get('/menu', authMiddleware, requireSeller, getMenuController);

// Feedback (seller dashboard)
router.post('/feedback-experience', authMiddleware, requireSeller, feedbackExperienceController.createFeedbackExperience);

// Products (seller creates/updates items -> stored in products collection)
router.post('/products', authMiddleware, requireSeller, async (req, res, next) => {
    await invalidateCache('seller_menu:*');
    next();
}, createSellerProductController);
// Declared before /products/:id so "stock" and "low-stock" are not swallowed as ids.
router.patch('/products/stock', authMiddleware, requireSeller, async (req, res, next) => {
    await invalidateCache('seller_menu:*');
    await invalidateCache('search_products:*');
    next();
}, updateSellerProductStockController);
router.get('/products/low-stock', authMiddleware, requireSeller, listLowStockProductsController);
router.get('/analytics', authMiddleware, requireSeller, getAnalyticsController);

router.delete('/products/:id', authMiddleware, requireSeller, async (req, res, next) => {
    await invalidateCache('seller_menu:*');
    await invalidateCache('search_products:*');
    next();
}, deleteSellerProductController);

router.patch('/products/:id', authMiddleware, requireSeller, async (req, res, next) => {
    await invalidateCache('seller_menu:*');
    await invalidateCache('search_products:*');
    next();
}, updateSellerProductController);

// Bulk Menu Upload
router.get('/bulk-upload/template', authMiddleware, requireSeller, downloadBulkMenuTemplateController);
router.post('/bulk-upload', authMiddleware, requireSeller, upload.single('file'), uploadBulkMenuController);

// Orders (seller dashboard)
router.get('/orders', authMiddleware, requireSeller, orderController.listOrdersSellerController);
router.get('/returns', authMiddleware, requireSeller, listReturnsSellerController);
router.get('/orders/:orderId', authMiddleware, requireSeller, orderController.getOrderByIdSellerController);
router.patch('/orders/:orderId/status', authMiddleware, requireSeller, orderController.updateOrderStatusSellerController);
router.post('/orders/:orderId/shipment', authMiddleware, requireSeller, orderController.createOrderShipmentSellerController);
router.get('/orders/:orderId/shipment/track', authMiddleware, requireSeller, orderController.trackOrderShipmentSellerController);
router.post('/orders/:orderId/resend-notification', authMiddleware, requireSeller, orderController.resendDeliveryNotificationSellerController);

// Complaints (seller dashboard)
router.get('/complaints', authMiddleware, requireSeller, getSellerComplaintsController);
router.post('/support/tickets', authMiddleware, requireSeller, createSellerSupportTicketController);
router.get('/support/tickets', authMiddleware, requireSeller, listSellerSupportTicketsController);

// Offers (seller dashboard)
router.get('/my-offers', authMiddleware, requireSeller, listSellerOffersController);
router.post('/my-offers', authMiddleware, requireSeller, createSellerOfferController);
router.patch('/my-offers/:id/status', authMiddleware, requireSeller, updateSellerOfferStatusController);
router.delete('/my-offers/:id', authMiddleware, requireSeller, deleteSellerOfferController);

// Product reviews of this store's products: list, reply once, report.
router.use('/reviews', authMiddleware, requireSeller, sellerReviewRoutes);

export default router;
