import express from 'express';
import * as c from '../controllers/pushCampaign.controller.js';

/** Mounted at /admin/push-campaigns (section: promotions_management). */
export const pushCampaignAdminRoutes = express.Router();
pushCampaignAdminRoutes.get('/', c.list);
pushCampaignAdminRoutes.post('/', c.create);
pushCampaignAdminRoutes.post('/audience-preview', c.preview);
pushCampaignAdminRoutes.get('/settings', c.getSettings);
pushCampaignAdminRoutes.put('/settings', c.updateSettings);
pushCampaignAdminRoutes.get('/:id', c.get);
pushCampaignAdminRoutes.patch('/:id', c.update);
pushCampaignAdminRoutes.post('/:id/pause', c.pause);
pushCampaignAdminRoutes.post('/:id/resume', c.resume);
pushCampaignAdminRoutes.post('/:id/cancel', c.cancel);
pushCampaignAdminRoutes.delete('/:id', c.remove);

/** Mounted at /admin/first-order-guard (section: promotions_management). */
export const firstOrderGuardAdminRoutes = express.Router();
firstOrderGuardAdminRoutes.get('/settings', c.getGuardSettings);
firstOrderGuardAdminRoutes.put('/settings', c.updateGuardSettings);
firstOrderGuardAdminRoutes.get('/claims', c.listGuardClaims);
