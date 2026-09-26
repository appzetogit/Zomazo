import { sendResponse } from '../../../../utils/response.js';
import {
    getSellerMenu,
    getPublicApprovedSellerMenu
} from '../services/sellerMenu.service.js';

export const getMenuController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const menu = await getSellerMenu(sellerId);
        return sendResponse(res, 200, 'Menu fetched successfully', { menu });
    } catch (error) {
        next(error);
    }
};

export const getPublicSellerMenuController = async (req, res, next) => {
    try {
        const menu = await getPublicApprovedSellerMenu(req.params.id, { fulfilmentMode: req.query?.fulfilmentMode });
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        return sendResponse(res, 200, 'Menu fetched successfully', { menu });
    } catch (error) {
        next(error);
    }
};

