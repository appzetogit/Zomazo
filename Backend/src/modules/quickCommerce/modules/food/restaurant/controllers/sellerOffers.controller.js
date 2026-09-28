import { sendResponse } from '../../../../utils/response.js';
import { normalizeBogoOffersInput } from '../../../../../food/shared/bogoOffer.js';
import { normalizeFreebieTiersInput } from '../../../../../food/shared/freebieRewards.js';
import { qcBogo, qcFreebie } from '../../shared/offers.js';

/**
 * A quick-commerce seller's own offers, on the same screens and rules food
 * restaurants use: buy-one-get-one products and a free item once an order
 * reaches a spend. Checkout applies them (order-pricing.service.js).
 */

export const getFreebieOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const offer = await qcFreebie.getFreebieOffer(restaurantId);
        return sendResponse(res, 200, 'Free item offer fetched successfully', {
            offer: offer || { restaurantId, isActive: true, tiers: [] },
        });
    } catch (error) {
        next(error);
    }
};

export const updateFreebieOfferController = async (req, res, next) => {
    try {
        let tiers;
        try {
            tiers = normalizeFreebieTiersInput(req.body || {})?.tiers;
        } catch (validationError) {
            return sendResponse(res, 400, validationError.message, null);
        }
        const offer = await qcFreebie.saveFreebieOffer(req.user?.userId, {
            tiers,
            isActive: req.body?.isActive,
            updatedByRole: 'RESTAURANT',
        });
        return sendResponse(res, 200, 'Free item offer saved successfully', { offer });
    } catch (error) {
        next(error);
    }
};

export const getBogoOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const offer = await qcBogo.getBogoOffer(restaurantId);
        return sendResponse(res, 200, 'Buy one get one offer fetched successfully', {
            offer: offer || { restaurantId, isActive: true, offers: [] },
        });
    } catch (error) {
        next(error);
    }
};

export const updateBogoOfferController = async (req, res, next) => {
    try {
        let offers;
        try {
            offers = normalizeBogoOffersInput(req.body || {})?.offers;
        } catch (validationError) {
            return sendResponse(res, 400, validationError.message, null);
        }
        const offer = await qcBogo.saveBogoOffer(req.user?.userId, {
            offers,
            isActive: req.body?.isActive,
            updatedByRole: 'RESTAURANT',
        });
        return sendResponse(res, 200, 'Buy one get one offer saved successfully', { offer });
    } catch (error) {
        next(error);
    }
};
