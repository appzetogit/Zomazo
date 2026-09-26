import { sendResponse } from '../../../../utils/response.js';
import * as spinService from '../services/spin.service.js';

export const getSpinStatusController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const status = await spinService.getSpinStatus(userId);
        return sendResponse(res, 200, 'Spin status fetched successfully', status);
    } catch (error) {
        next(error);
    }
};

export const playSpinController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const ip = req.ip || req.connection?.remoteAddress || '';
        const result = await spinService.playSpin(userId, { ip });
        return sendResponse(res, 200, 'Spin completed successfully', result);
    } catch (error) {
        next(error);
    }
};

// ---- admin -----------------------------------------------------------------

const respond = (fn, message, status = 200) => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (error) {
        next(error);
    }
};

export const listSpinCampaignsController = respond(() => spinService.listCampaigns(), 'Spin campaigns fetched');
export const createSpinCampaignController = respond((req) => spinService.createCampaign(req.body || {}), 'Spin campaign created', 201);
export const updateSpinCampaignController = respond((req) => spinService.updateCampaign(req.params.id, req.body || {}), 'Spin campaign updated');
export const setSpinCampaignActiveController = respond(
    (req) => spinService.setCampaignActive(req.params.id, req.body?.isActive !== false),
    'Spin campaign updated',
);
export const getSpinReportController = respond((req) => spinService.getSpinReport({ month: req.query.month }), 'Spin report fetched');
