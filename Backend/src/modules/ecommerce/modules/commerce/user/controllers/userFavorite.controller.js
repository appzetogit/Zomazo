import { sendResponse } from '../../../../utils/response.js';
import * as favoriteService from '../services/userFavorite.service.js';

const me = (req) => req.user?.userId;

export async function getFavoritesController(req, res, next) {
    try {
        const data = await favoriteService.getUserFavorites(me(req));
        return sendResponse(res, 200, 'Favorites fetched', data);
    } catch (err) {
        next(err);
    }
}

export async function addFavoriteSellerController(req, res, next) {
    try {
        const data = await favoriteService.addFavoriteSeller(
            me(req),
            req.params.sellerId
        );
        return sendResponse(res, 200, 'Store added to favorites', data);
    } catch (err) {
        next(err);
    }
}

export async function removeFavoriteSellerController(req, res, next) {
    try {
        const data = await favoriteService.removeFavoriteSeller(
            me(req),
            req.params.sellerId
        );
        return sendResponse(res, 200, 'Store removed from favorites', data);
    } catch (err) {
        next(err);
    }
}

export async function addFavoriteProductController(req, res, next) {
    try {
        const data = await favoriteService.addFavoriteProduct(me(req), req.params.productId);
        return sendResponse(res, 200, 'Added to favorites', data);
    } catch (err) {
        next(err);
    }
}

export async function removeFavoriteProductController(req, res, next) {
    try {
        const data = await favoriteService.removeFavoriteProduct(me(req), req.params.productId);
        return sendResponse(res, 200, 'Removed from favorites', data);
    } catch (err) {
        next(err);
    }
}
