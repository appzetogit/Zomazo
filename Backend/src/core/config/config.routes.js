import express from 'express';
import { requireFinancePermission } from '../admin/requireFinancePermission.middleware.js';
import {
    getCatalogueController,
    explainSettingController,
    resolveAllController,
    setSettingController,
    invalidateCacheController,
} from './config.controller.js';
import {
    getProfileController,
    updateProfileController,
    testRazorpayController,
    testEmailController,
    testSmsController,
} from '../settings/platformProfile.controller.js';
import { listAppLegal, saveAppLegal } from '../settings/appLegal.js';
import { getEarningsController } from '../finance/earnings.controller.js';
import { listGlobalUsersController, exportGlobalUsersController } from '../users/globalUsers.controller.js';
import { referralOverview } from '../referral/referralSettings.service.js';
import { listReferralActivity } from '../referral/referralActivity.service.js';
import { platformFeesOverview } from '../finance/platformFees.service.js';

/**
 * Master / Global settings.
 *
 * Mounted under /v1/platform/settings rather than under a vertical, because that
 * is the whole point: these are the rules that apply everywhere, and putting them
 * beneath /food/admin would reproduce the problem they exist to solve.
 *
 * READS are open to any authenticated admin. WRITES need `settings.write`.
 * Deliberately asymmetric -- an operator who cannot change the cash limit should
 * still be able to see what it is and which level set it, or the first question
 * every support conversation starts with has no answer.
 */
const router = express.Router();

// Master settings: brand, contact, legal pages, integrations
// (core/settings/platformProfile.service.js). Declared before '/:key'.
router.get('/profile', getProfileController);
router.patch('/profile', requireFinancePermission('PLATFORM_SETTING_SET'), updateProfileController);
router.post('/profile/test/razorpay', requireFinancePermission('PLATFORM_SETTING_SET'), testRazorpayController);
router.post('/profile/test/email', requireFinancePermission('PLATFORM_SETTING_SET'), testEmailController);
router.post('/profile/test/sms', requireFinancePermission('PLATFORM_SETTING_SET'), testSmsController);

// Terms and privacy per app (core/settings/appLegal.js).
router.get('/app-legal', listAppLegal);
router.put('/app-legal/:app/:kind', requireFinancePermission('PLATFORM_SETTING_SET'), saveAppLegal);

// What a module pays its riders today, and its own bands to start an edit from
// (core/finance/earnings.controller.js). Declared before '/:key'.
router.get('/earnings/:vertical', getEarningsController);

/*
 * Master > Customers: every customer on the platform, in one list.
 *
 * Reads are open to any authenticated admin, like the rest of this router. The
 * EXPORT is not: a file of every customer's name, phone and spend is a
 * different thing from a paginated screen, so it needs the same permission as
 * changing a platform setting.
 */
router.get('/users', listGlobalUsersController);
router.get('/users/export', requireFinancePermission('PLATFORM_SETTING_SET'), exportGlobalUsersController);

// Master > Referral: what each service pays now, and whether Master or the
// service set it. Declared before '/:key'.
router.get('/referral/overview', async (req, res, next) => {
    try {
        res.json({ success: true, data: await referralOverview() });
    } catch (err) {
        next(err);
    }
});
// Master > Referral activity: who referred whom and what it paid, every service.
router.get('/referral/activity', async (req, res, next) => {
    try {
        res.json({ success: true, data: await listReferralActivity(req.query || {}) });
    } catch (err) {
        next(err);
    }
});
// Master > Platform Fee & GST: what each service charges now, and who set it.
router.get('/fees/overview', async (req, res, next) => {
    try {
        res.json({ success: true, data: await platformFeesOverview() });
    } catch (err) {
        next(err);
    }
});
// Master > Cancellation Policy: the rules each service is using now, and who set them.
router.get('/cancellation/overview', async (req, res, next) => {
    try {
        const { getCancelRules } = await import('../../modules/food/orders/services/cancellationPolicy.js');
        const { holdSecondsFor } = await import('../orders/orderHold.js');
        const [food, quickCommerce, foodHold, quickHold] = await Promise.all([
            getCancelRules('food'), getCancelRules('quickCommerce'),
            holdSecondsFor('food'), holdSecondsFor('quickCommerce'),
        ]);
        res.json({ success: true, data: { services: [
            { vertical: 'food', ...food, holdSeconds: foodHold },
            { vertical: 'quickCommerce', ...quickCommerce, holdSeconds: quickHold },
        ] } });
    } catch (err) {
        next(err);
    }
});
// Zone pickers on the Master pages: one module's zones (each module draws its own).
router.get('/zones/:module', async (req, res, next) => {
    try {
        const { listZonesFor } = await import('../appServices/appServices.service.js');
        const zones = await listZonesFor(String(req.params.module || ''));
        if (!zones) return res.status(400).json({ success: false, message: 'Unknown module' });
        return res.json({ success: true, data: { zones } });
    } catch (err) {
        return next(err);
    }
});
router.get('/catalogue', getCatalogueController);
router.get('/resolve', resolveAllController);
router.get('/:key/explain', explainSettingController);

router.put('/:key', requireFinancePermission('PLATFORM_SETTING_SET'), setSettingController);
router.post('/cache/invalidate', requireFinancePermission('PLATFORM_SETTING_SET'), invalidateCacheController);

export default router;
