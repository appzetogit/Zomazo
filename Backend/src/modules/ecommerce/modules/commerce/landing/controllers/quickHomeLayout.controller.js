import { sendResponse } from '../../../../utils/response.js';
import {
    getAdminQuickHomeLayout,
    getPublicQuickHomeLayout,
    resetQuickHomeLayout,
    saveQuickHomeLayout,
} from '../services/quickHomeLayout.service.js';

/** GET /content/quick-home?zoneId= — what the Quick phone home shows. */
export const getPublicQuickHomeController = async (req, res, next) => {
    try {
        const data = await getPublicQuickHomeLayout(req.query?.zoneId);
        return sendResponse(res, 200, 'Quick home layout fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

/** GET /admin/quick-home-layout?zoneId= — the stored layout for the editor. */
export const getAdminQuickHomeController = async (req, res, next) => {
    try {
        const data = await getAdminQuickHomeLayout(req.query?.zoneId);
        return sendResponse(res, 200, 'Quick home layout fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

/** PUT /admin/quick-home-layout?zoneId= — replaces a zone's (or the global) layout. */
export const saveAdminQuickHomeController = async (req, res, next) => {
    try {
        const layout = await saveQuickHomeLayout(req.query?.zoneId || null, req.body || {});
        return sendResponse(res, 200, 'Quick home layout saved', { layout });
    } catch (error) {
        next(error);
    }
};

/** DELETE /admin/quick-home-layout?zoneId= — a zone goes back to the global layout. */
export const resetAdminQuickHomeController = async (req, res, next) => {
    try {
        const data = await resetQuickHomeLayout(req.query?.zoneId);
        return sendResponse(res, 200, 'Zone layout removed; the global layout applies', data);
    } catch (error) {
        next(error);
    }
};
