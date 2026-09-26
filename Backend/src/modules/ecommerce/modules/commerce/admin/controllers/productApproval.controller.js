import { sendResponse, sendError } from '../../../../utils/response.js';
import {
    listPendingProductApprovals,
    approveProduct,
    rejectProduct
} from '../services/productApproval.service.js';

export async function getPendingProductApprovals(req, res, next) {
    try {
        const data = await listPendingProductApprovals(req.query || {});
        return sendResponse(res, 200, 'Pending product approvals fetched successfully', data);
    } catch (error) {
        next(error);
    }
}

export async function approveProductController(req, res, next) {
    try {
        const updated = await approveProduct(req.params.id);
        if (!updated) return sendError(res, 404, 'Product not found or not pending');
        return sendResponse(res, 200, 'Product approved successfully', { product: updated });
    } catch (error) {
        next(error);
    }
}

export async function rejectProductController(req, res, next) {
    try {
        const updated = await rejectProduct(req.params.id, req.body?.reason);
        if (!updated) return sendError(res, 404, 'Product not found or not pending');
        return sendResponse(res, 200, 'Product rejected successfully', { product: updated });
    } catch (error) {
        next(error);
    }
}

