import { sendResponse } from '../../../../utils/response.js';
import { getOutletTimingsForSeller, upsertOutletTimingsForSeller } from '../services/outletTimings.service.js';

export const getOutletTimingsBySellerIdController = async (req, res, next) => {
    try {
        const data = await getOutletTimingsForSeller(req.params.id);
        return sendResponse(res, 200, 'Outlet timings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getCurrentSellerOutletTimingsController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const data = await getOutletTimingsForSeller(sellerId);
        return sendResponse(res, 200, 'Outlet timings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const upsertCurrentSellerOutletTimingsController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const data = await upsertOutletTimingsForSeller(sellerId, req.body?.outletTimings);
        return sendResponse(res, 200, 'Outlet timings saved successfully', data);
    } catch (error) {
        next(error);
    }
};

