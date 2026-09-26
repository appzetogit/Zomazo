import * as sellerService from '../services/seller.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { validateCreateOfferDto } from '../../admin/validators/offer.validator.js';

export const createSellerOfferController = async (req, res) => {
    try {
        const sellerId = req.user.userId;
        // Inject sellerId into body for validation
        const payload = validateCreateOfferDto({
            ...req.body,
            sellerScope: 'selected',
            sellerId: sellerId
        });
        const doc = await sellerService.createSellerOffer(sellerId, payload);
        return sendResponse(res, 201, 'Offer created successfully', { doc });
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};

export const listSellerOffersController = async (req, res) => {
    try {
        const sellerId = req.user.userId;
        const list = await sellerService.listSellerOffers(sellerId);
        return sendResponse(res, 200, 'Offers fetched successfully', { offers: list });
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};

export const deleteSellerOfferController = async (req, res) => {
    try {
        const sellerId = req.user.userId;
        const { id: offerId } = req.params;
        await sellerService.deleteSellerOffer(sellerId, offerId);
        return sendResponse(res, 200, 'Offer deleted successfully');
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};

export const updateSellerOfferStatusController = async (req, res) => {
    try {
        const sellerId = req.user.userId;
        const { id: offerId } = req.params;
        const { status } = req.body;
        const doc = await sellerService.updateSellerOfferStatus(sellerId, offerId, status);
        return sendResponse(res, 200, 'Offer status updated successfully', { doc });
    } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
    }
};
