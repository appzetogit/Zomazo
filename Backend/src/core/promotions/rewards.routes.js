import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import * as rewards from './rewardsAdmin.service.js';

/**
 * /v1/platform/rewards: admin > Cashback, Wallet Bonus, Loyalty Points.
 *
 * Open to any admin, like Master > Coupons; what each one may see and change is
 * decided per request by the `promotions` permission (rewardsAdmin.service.js).
 */
const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.use(authMiddleware, requireRoles('ADMIN'));
router.use(async (req, res, next) => {
  try {
    const admin = await loadAdminCached(req.user?.userId || req.user?.id);
    if (!admin) return sendError(res, 403, 'Admin account not found');
    if (admin.isActive === false) return sendError(res, 403, 'Your admin account has been deactivated');
    req.platformAdmin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

const handle = (fn, message = 'OK') => async (req, res) => {
  try {
    return sendResponse(res, 200, message, await fn(req));
  } catch (err) {
    const status = err?.statusCode || err?.status || (err?.name === 'ValidationError' ? 400 : 500);
    return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
  }
};

router.get('/cashback', handle((req) => rewards.listCashbackOffers(req.platformAdmin, req.query)));
router.post('/cashback', handle((req) => rewards.createCashbackOffer(req.platformAdmin, req.body || {}), 'Cashback offer created'));
router.patch('/cashback/:id', handle((req) => rewards.updateCashbackOffer(req.platformAdmin, req.params.id, req.body || {}), 'Saved'));
router.delete('/cashback/:id', handle((req) => rewards.deleteCashbackOffer(req.platformAdmin, req.params.id), 'Deleted'));

router.get('/wallet-bonus', handle((req) => rewards.listWalletBonuses(req.platformAdmin, req.query)));
router.post('/wallet-bonus', handle((req) => rewards.createWalletBonus(req.platformAdmin, req.body || {}), 'Wallet bonus created'));
router.patch('/wallet-bonus/:id', handle((req) => rewards.updateWalletBonus(req.platformAdmin, req.params.id, req.body || {}), 'Saved'));
router.delete('/wallet-bonus/:id', handle((req) => rewards.deleteWalletBonus(req.platformAdmin, req.params.id), 'Deleted'));

router.get('/loyalty/settings', handle((req) => rewards.readLoyaltySettings(req.platformAdmin)));
router.put('/loyalty/settings', handle((req) => rewards.writeLoyaltySettings(req.platformAdmin, req.body || {}), 'Saved'));
router.get('/loyalty/report', handle((req) => rewards.readLoyaltyReport(req.platformAdmin, req.query)));

export default router;
