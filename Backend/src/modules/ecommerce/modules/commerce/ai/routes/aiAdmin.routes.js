import express from 'express';
import { requireAdminPermission } from '../../../../core/roles/adminPermission.middleware.js';
import * as c from '../controllers/aiAdmin.controller.js';

/**
 * /api/v1/admin/ai. Mounted in admin.routes.js behind the admin check and
 * system_settings view; changing settings needs system_settings edit.
 */
const router = express.Router();

router.get('/settings', c.getSettings);
router.put('/settings', requireAdminPermission('system_settings', 'edit'), c.putSettings);
router.get('/conversations', c.listConversationsController);
router.get('/conversations/:id', c.getConversationController);
router.get('/usage', c.getUsageController);

export default router;
