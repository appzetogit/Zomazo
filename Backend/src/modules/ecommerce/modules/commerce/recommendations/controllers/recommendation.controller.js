import { sendResponse } from '../../../../utils/response.js';
import { getProductRecommendations } from '../services/recommendation.service.js';

/** GET /catalog/products/:id/recommendations?type=frequently_bought|similar&fulfilmentMode=&limit= */
export const getProductRecommendationsController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Recommendations fetched successfully', await getProductRecommendations(req.params.id, req.query));
    } catch (error) {
        next(error);
    }
};
