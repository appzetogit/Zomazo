import { sendResponse } from '../../../../utils/response.js';
import {
    listSavedForLater,
    saveForLater,
    moveSavedToCart,
    removeSavedForLater,
} from '../services/savedForLater.service.js';

/** GET /user/saved-for-later?mode=shop|quick */
export const listSavedForLaterController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Saved for later', await listSavedForLater(req.user.userId, req.query?.mode));
    } catch (error) {
        return next(error);
    }
};

/** POST /user/saved-for-later { mode, productId, variantId?, qty } */
export const saveForLaterController = async (req, res, next) => {
    try {
        const data = await saveForLater(req.user.userId, req.body || {});
        return sendResponse(res, data.created ? 201 : 200, 'Saved for later', data);
    } catch (error) {
        return next(error);
    }
};

/** POST /user/saved-for-later/:id/move-to-cart */
export const moveSavedToCartController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Moved to cart', await moveSavedToCart(req.user.userId, req.params.id));
    } catch (error) {
        return next(error);
    }
};

/** DELETE /user/saved-for-later/:id */
export const removeSavedForLaterController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Removed', await removeSavedForLater(req.user.userId, req.params.id));
    } catch (error) {
        return next(error);
    }
};
