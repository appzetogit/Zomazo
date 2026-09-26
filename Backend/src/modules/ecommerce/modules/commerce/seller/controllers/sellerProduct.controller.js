import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    createSellerProduct,
    deleteSellerProduct,
    updateSellerProduct,
    updateSellerProductStock,
    listLowStockProducts
} from '../services/sellerProduct.service.js';
import { getSellerAnalytics } from '../services/sellerAnalytics.service.js';

export const createSellerProductController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const product = await createSellerProduct(sellerId, req.body || {});
        return sendResponse(res, 201, 'Product created successfully', { product });
    } catch (error) {
        next(error);
    }
};

/** PATCH /products/stock — set counts on many products in one call. */
export const updateSellerProductStockController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const entries = Array.isArray(req.body) ? req.body : (req.body?.items ?? (req.body?.itemId ? req.body : undefined));
        const result = await updateSellerProductStock(sellerId, entries);
        return sendResponse(res, 200, 'Stock updated successfully', result);
    } catch (error) {
        next(error);
    }
};

/** GET /products/low-stock — what needs reordering. */
export const listLowStockProductsController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await listLowStockProducts(sellerId, { channel: req.query?.channel });
        return sendResponse(res, 200, 'Low stock items fetched successfully', result);
    } catch (error) {
        next(error);
    }
};

/** GET /analytics?from=&to= — sales figures over a date range. */
export const getAnalyticsController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await getSellerAnalytics(sellerId, req.query || {});
        return sendResponse(res, 200, 'Analytics fetched successfully', result);
    } catch (error) {
        next(error);
    }
};

/** DELETE /products/:id — removes one of the seller's own products. */
export const deleteSellerProductController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const deleted = await deleteSellerProduct(sellerId, req.params.id);
        if (!deleted) return sendError(res, 404, 'Product not found');
        return sendResponse(res, 200, 'Product deleted successfully', deleted);
    } catch (error) {
        next(error);
    }
};

export const updateSellerProductController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const product = await updateSellerProduct(sellerId, req.params.id, req.body || {});
        if (!product) return sendError(res, 404, 'Product not found');
        return sendResponse(res, 200, 'Product updated successfully', { product });
    } catch (error) {
        next(error);
    }
};

