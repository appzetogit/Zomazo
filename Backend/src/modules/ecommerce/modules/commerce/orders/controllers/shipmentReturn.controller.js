import { sendResponse } from '../../../../utils/response.js';
import * as shipments from '../services/shipmentAdmin.service.js';
import * as returns from '../services/returnRequest.service.js';

const handle = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req));
    } catch (err) {
        return next(err);
    }
};

const who = (req) => req.user?.userId;

// ---- admin: shipments ----
export const listShipmentsAdminController = handle((req) => shipments.listShipments(req.query), 'Shipments retrieved');
export const trackShipmentAdminController = handle((req) => shipments.trackShipmentAdmin(req.params.orderId, who(req)), 'Tracking retrieved');
export const bookShipmentAdminController = handle((req) => shipments.bookShipmentAdmin(req.params.orderId, who(req)), 'Shipment booked');
export const cancelShipmentAdminController = handle(
    (req) => shipments.cancelShipmentAdmin(req.params.orderId, who(req), req.body?.reason),
    'Shipment cancelled'
);

// ---- admin: returns ----
export const listReturnsAdminController = handle((req) => returns.listReturnsAdmin(req.query), 'Returns retrieved');
export const getReturnSettingsAdminController = handle(async () => ({ returnWindowDays: await returns.getReturnWindowDays() }), 'Return settings');
export const updateReturnSettingsAdminController = handle((req) => returns.updateReturnSettings(req.body || {}), 'Return settings saved');
export const getReturnAdminController = handle((req) => returns.getReturnAdmin(req.params.id), 'Return retrieved');
export const approveReturnAdminController = handle(
    (req) => returns.approveReturnAdmin(req.params.id, who(req), { bookPickup: Boolean(req.body?.bookPickup), note: req.body?.note }),
    'Return approved'
);
export const rejectReturnAdminController = handle((req) => returns.rejectReturnAdmin(req.params.id, who(req), req.body?.reason), 'Return rejected');
export const receiveReturnAdminController = handle(
    (req) => returns.receiveAndRefundReturnAdmin(req.params.id, who(req), { note: req.body?.note }),
    'Return received and refunded'
);

// ---- customer ----
export const getOrderReturnsUserController = handle((req) => returns.getOrderReturnsUser(who(req), req.params.orderId), 'Returns retrieved');
export async function createReturnUserController(req, res, next) {
    try {
        const data = await returns.createReturnUser(who(req), req.params.orderId, req.body || {});
        return sendResponse(res, 201, 'Return requested', data);
    } catch (err) {
        return next(err);
    }
}

// ---- seller ----
export const listReturnsSellerController = handle((req) => returns.listReturnsSeller(who(req), req.query), 'Returns retrieved');
