import express from 'express';
import * as c from '../controllers/productReview.controller.js';

/**
 * Product review routers, one per caller. Each is mounted by the router that
 * already guards that caller:
 *   userReviewRoutes   -> /v1/user/reviews         (auth + USER, user.routes.js)
 *   sellerReviewRoutes -> /v1/seller/reviews       (seller.routes.js adds auth + SELLER)
 *   adminReviewRoutes  -> /v1/admin/product-reviews (admin.routes.js; section product_management)
 * The public list is GET /v1/catalog/products/:id/reviews (catalog.routes.js).
 */

export const userReviewRoutes = express.Router();
userReviewRoutes.get('/', c.listMyReviewsController);
userReviewRoutes.get('/eligibility/:productId', c.getEligibilityController);
userReviewRoutes.put('/products/:productId', c.upsertMyReviewController);
userReviewRoutes.delete('/products/:productId', c.deleteMyReviewController);
userReviewRoutes.post('/:reviewId/helpful', c.voteHelpfulController);
userReviewRoutes.delete('/:reviewId/helpful', c.unvoteHelpfulController);
userReviewRoutes.post('/:reviewId/report', c.reportReviewUserController);

export const sellerReviewRoutes = express.Router();
sellerReviewRoutes.get('/', c.listSellerReviewsController);
sellerReviewRoutes.post('/:reviewId/reply', c.replyToReviewController);
sellerReviewRoutes.post('/:reviewId/report', c.reportReviewSellerController);

export const adminReviewRoutes = express.Router();
adminReviewRoutes.get('/', c.listReviewsAdminController);
adminReviewRoutes.patch('/:id/hide', c.hideReviewController);
adminReviewRoutes.patch('/:id/unhide', c.unhideReviewController);
adminReviewRoutes.delete('/:id', c.removeReviewController);

export const listProductReviewsController = c.listProductReviewsController;
