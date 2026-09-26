import {
    listSellerCategories,
    listPublicCategories,
    createSellerCategory,
    updateSellerCategory,
    deleteSellerCategory
} from '../services/sellerCategory.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { Seller } from '../models/seller.model.js';

export const listCategoriesController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        // Default to seller's zone when caller doesn't pass zoneId.
        // This returns (zone categories + global categories) instead of only global.
        const query = { ...(req.query || {}) };
        if (!sellerId) {
            // Public endpoint: no auth available. Return approved categories (zone-aware).
            const data = await listPublicCategories(query);
            return sendResponse(res, 200, 'Categories fetched successfully', data);
        }

        if (!query.zoneId) {
            const r = await Seller.findById(sellerId).select('zoneId').lean();
            if (r?.zoneId) {
                query.zoneId = String(r.zoneId);
            }
        }
        const data = await listSellerCategories(sellerId, query);
        return sendResponse(res, 200, 'Categories fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createCategoryController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const category = await createSellerCategory(sellerId, req.body || {});
        return sendResponse(res, 201, 'Category created successfully', { category });
    } catch (error) {
        next(error);
    }
};

export const updateCategoryController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const category = await updateSellerCategory(sellerId, req.params.id, req.body || {});
        if (!category) return sendError(res, 404, 'Category not found');
        return sendResponse(res, 200, 'Category updated successfully', { category });
    } catch (error) {
        next(error);
    }
};

export const deleteCategoryController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await deleteSellerCategory(sellerId, req.params.id);
        if (!result) return sendError(res, 404, 'Category not found');
        return sendResponse(res, 200, 'Category deleted successfully', result);
    } catch (error) {
        next(error);
    }
};

