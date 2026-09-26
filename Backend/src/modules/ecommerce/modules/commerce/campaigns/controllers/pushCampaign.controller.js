import { sendResponse } from '../../../../utils/response.js';
import * as svc from '../services/pushCampaign.service.js';
import * as guard from '../../orders/services/firstOrderGuard.service.js';

const adminOf = (req) => req.user?.userId;
const userOf = (req) => req.user?.userId || req.user?.id;

/** One wrapper: service errors carry their own status; the error handler formats them. */
const handle = (fn, message, status = 200) => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (err) {
        return next(err);
    }
};

// ----- Admin: push campaigns -----
export const list = handle((req) => svc.listPushCampaigns(req.query || {}), 'Campaigns');
export const get = handle((req) => svc.getPushCampaign(req.params.id), 'Campaign');
export const create = handle((req) => svc.createPushCampaign(req.body || {}, adminOf(req)), 'Campaign created', 201);
export const update = handle((req) => svc.updatePushCampaign(req.params.id, req.body || {}), 'Campaign updated');
export const pause = handle((req) => svc.setPushCampaignState(req.params.id, 'pause'), 'Campaign paused');
export const resume = handle((req) => svc.setPushCampaignState(req.params.id, 'resume'), 'Campaign resumed');
export const cancel = handle((req) => svc.setPushCampaignState(req.params.id, 'cancel'), 'Campaign cancelled');
export const remove = handle((req) => svc.deletePushCampaign(req.params.id), 'Campaign deleted');
export const preview = handle((req) => svc.previewAudience(req.body?.audience || req.body || {}), 'Audience');
export const getSettings = handle(() => svc.getMarketingPushSettings(), 'Settings');
export const updateSettings = handle((req) => svc.updateMarketingPushSettings(req.body || {}, adminOf(req)), 'Settings saved');

// ----- Admin: first-order guard -----
export const getGuardSettings = handle(() => guard.getFirstOrderGuardSettings(), 'Settings');
export const updateGuardSettings = handle((req) => guard.updateFirstOrderGuardSettings(req.body || {}, adminOf(req)), 'Settings saved');
export const listGuardClaims = handle((req) => guard.listFirstOrderClaims(req.query || {}), 'Claims');

// ----- Customer: notification preferences -----
export const getMyPreferences = handle((req) => svc.getNotificationPreferences('USER', userOf(req)), 'Preferences');
export const setMyPreferences = handle((req) => svc.setNotificationPreferences('USER', userOf(req), req.body || {}), 'Preferences saved');

// ----- Anyone: a campaign push was tapped (the signed open token is the proof; no sign-in needed) -----
export const recordOpen = handle((req) => svc.recordCampaignOpen({
    deliveryId: req.body?.deliveryId,
    openToken: req.body?.openToken,
}), 'Recorded');
