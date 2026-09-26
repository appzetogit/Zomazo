import { getDeliveryEstimate } from '../services/deliveryEstimate.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';

/** GET /catalog/delivery-estimate?pincode=560001&fulfilmentMode=standard */
export async function deliveryEstimateController(req, res, next) {
    try {
        const mode = String(req.query.fulfilmentMode || 'standard').trim();
        if (mode !== 'standard') {
            return sendError(res, 400, 'Only fulfilmentMode=standard has a delivery date; Quick uses the zone ETA');
        }
        const pincode = String(req.query.pincode || '').trim();
        if (pincode && !/^\d{6}$/.test(pincode)) {
            return sendError(res, 400, 'pincode must be 6 digits');
        }
        const data = await getDeliveryEstimate({ pincode });
        return sendResponse(res, 200, 'Delivery estimate', data);
    } catch (error) {
        next(error);
    }
}
