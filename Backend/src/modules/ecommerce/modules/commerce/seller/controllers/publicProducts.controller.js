import { sendResponse, sendError } from '../../../../utils/response.js';
import { listPublicProducts, getPublicProduct } from '../services/publicProducts.service.js';

export const listPublicProductsController = async (req, res, next) => {
    try {
        const data = await listPublicProducts(req.query || {});
        return sendResponse(res, 200, 'Products fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getPublicProductController = async (req, res, next) => {
    try {
        const data = await getPublicProduct(req.params.id, req.query || {});
        if (!data) return sendError(res, 404, 'Product not found');
        return sendResponse(res, 200, 'Product fetched successfully', data);
    } catch (error) {
        next(error);
    }
};
