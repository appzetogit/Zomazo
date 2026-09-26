import express from 'express';
import { optionalAuth } from '../../../../core/auth/auth.middleware.js';
import { cacheResponse } from '../../../../middleware/cache.js';
import {
    listApprovedSellersController,
    getApprovedSellerController,
    listPublicOffersController
} from '../../seller/controllers/seller.controller.js';
import { listCategoriesController } from '../../seller/controllers/sellerCategory.controller.js';
import { getPublicSellerMenuController } from '../../seller/controllers/sellerMenu.controller.js';
import { listPublicProductsController, getPublicProductController } from '../../seller/controllers/publicProducts.controller.js';
import { getOutletTimingsBySellerIdController } from '../../seller/controllers/outletTimings.controller.js';
import { listPublicAttributesController, getCategoryAttributesController } from '../../admin/controllers/attribute.controller.js';
import { nearbyStoresController } from '../../search/controllers/search.controller.js';
import searchRoutes from '../../search/routes/search.routes.js';
import { getProductRecommendationsController } from '../../recommendations/controllers/recommendation.controller.js';
import { listProductReviewsController } from '../../reviews/routes/productReview.routes.js';
import { deliveryEstimateController } from '../controllers/deliveryEstimate.controller.js';

/**
 * What a shopper browses, signed in or not: stores, their products, categories,
 * offers and search. Every read here is public and cached.
 *
 * The cache names are the ones the seller and admin write paths invalidate
 * (sellers:*, seller_menu:*, ...), so they must not change without them.
 */
const router = express.Router();

router.get('/stores', cacheResponse(300, 'sellers'), listApprovedSellersController);
// Before /stores/:id, which would otherwise read "nearby" as an id.
router.get('/stores/nearby', cacheResponse(60, 'stores_nearby', { browserTtlSeconds: 30 }), nearbyStoresController);
router.get('/stores/:id', cacheResponse(600, 'seller_detail'), getApprovedSellerController);
router.get('/stores/:id/products', cacheResponse(600, 'seller_menu'), getPublicSellerMenuController);
router.get('/stores/:id/timings', cacheResponse(600, 'seller_timings'), getOutletTimingsBySellerIdController);
router.get('/products', cacheResponse(300, 'public_products'), listPublicProductsController);
router.get('/products/:id', cacheResponse(120, 'public_product'), getPublicProductController);
// Not cached: votes and the signed-in customer's own review vary per request.
router.get('/products/:id/reviews', optionalAuth, listProductReviewsController);
router.get('/products/:id/recommendations', cacheResponse(300, 'product_recommendations', { browserTtlSeconds: 60 }), getProductRecommendationsController);
router.get('/categories', cacheResponse(600, 'categories'), listCategoriesController);
router.get('/categories/:id/attributes', getCategoryAttributesController);
router.get('/attributes', listPublicAttributesController);
// Shop (courier) delivery window for a pincode; the courier's answer is cached per pincode.
router.get('/delivery-estimate', deliveryEstimateController);
router.get('/offers', optionalAuth, listPublicOffersController);
router.use('/search', searchRoutes);

export default router;
