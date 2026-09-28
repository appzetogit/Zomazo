import { sendResponse, sendError } from '../../../../utils/response.js';
import { createRestaurantFood, deleteRestaurantFood, updateRestaurantFood } from '../services/restaurantFood.service.js';

export const createRestaurantFoodController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const food = await createRestaurantFood(restaurantId, req.body || {});
        return sendResponse(res, 201, 'Food created successfully', { food });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantFoodController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const food = await updateRestaurantFood(restaurantId, req.params.id, req.body || {});
        if (!food) return sendError(res, 404, 'Food not found');
        return sendResponse(res, 200, 'Food updated successfully', { food });
    } catch (error) {
        next(error);
    }
};

/** DELETE /foods/:id -- removes one of the restaurant's own dishes. */
export const deleteRestaurantFoodController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const deleted = await deleteRestaurantFood(restaurantId, req.params.id);
        if (!deleted) return sendError(res, 404, 'Food not found');
        return sendResponse(res, 200, 'Food deleted successfully', deleted);
    } catch (error) {
        next(error);
    }
};

