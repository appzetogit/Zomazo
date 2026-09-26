import { searchUnified, searchProducts, searchNearbyStores, getAdminCategories } from '../services/search.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { smartSearchProducts } from '../services/smartSearch.service.js';

/**
 * Unified Search for Sellers and Food Items
 */
export const searchController = async (req, res, next) => {
    try {
        const { q, lat, lng, radiusKm, categoryId, minRating, maxDeliveryTime, isVeg, page, limit, zoneId, strictZone, fulfilmentMode } = req.query;

        const results = await searchUnified({
            q,
            lat,
            lng,
            radiusKm,
            categoryId,
            minRating,
            maxDeliveryTime,
            isVeg,
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
            zoneId,
            strictZone,
            fulfilmentMode
        });

        return sendResponse(res, 200, 'Search results fetched successfully', results.data);
    } catch (error) {
        next(error);
    }
};

/**
 * Product search — returns items, not the sellers that stock them.
 */
export const searchProductsController = async (req, res, next) => {
    try {
        const { categoryIds, ...query } = req.query; // server-set only
        const smart = ['1', 'true'].includes(String(query.smart || ''));
        const results = smart ? await smartSearchProducts(query) : await searchProducts(query);

        return sendResponse(res, 200, 'Products fetched successfully', results);
    } catch (error) {
        next(error);
    }
};

/**
 * Fetch List of Admin-only Categories
 */
export const listAdminCategoriesController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const categories = await getAdminCategories({ zoneId });
        
        return sendResponse(res, 200, 'Admin categories fetched successfully', { categories });
    } catch (error) {
        next(error);
    }
};

/**
 * Stores near a point, nearest first.
 */
export const nearbyStoresController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Stores fetched successfully', await searchNearbyStores(req.query));
    } catch (error) {
        next(error);
    }
};
