import { sendResponse } from '../../../../utils/response.js';
import * as ops from '../services/courierOps.service.js';
import * as checkouts from '../services/checkoutAdmin.service.js';

const handle = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req));
    } catch (err) {
        return next(err);
    }
};
const who = (req) => req.user?.userId;

// NDR / RTO
export const listNdrController = handle((req) => ops.listNdr(req.query), 'NDR queue retrieved');
export const ndrActionController = handle((req) => ops.ndrActionAdmin(req.params.orderId, who(req), req.body || {}), 'NDR action recorded');
export const listRtoController = handle((req) => ops.listRto(req.query), 'RTO queue retrieved');
export const receiveRtoController = handle((req) => ops.receiveRtoAdmin(req.params.orderId, who(req), { note: req.body?.note }), 'RTO received');

// COD remittances
export const listRemittancesController = handle((req) => ops.listRemittances(req.query), 'Remittances retrieved');
export const codSummaryController = handle(() => ops.getCodSummary(), 'COD summary');
export const codOutstandingController = handle((req) => ops.listCodOutstanding(req.query), 'Outstanding COD');
export const previewRemittanceController = handle((req) => ops.previewRemittance(req.body || {}), 'Remittance matched');
export const createRemittanceController = handle((req) => ops.createRemittance(req.body || {}, who(req)), 'Remittance recorded');
export const getRemittanceController = handle((req) => ops.getRemittance(req.params.id), 'Remittance retrieved');

// Checkouts
export const listCheckoutsController = handle((req) => checkouts.listCheckoutsAdmin(req.query), 'Checkouts retrieved');
export const getCheckoutController = handle((req) => checkouts.getCheckoutAdmin(req.params.checkoutId), 'Checkout retrieved');
