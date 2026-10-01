import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { mailingListRateLimiter } from '../../middleware/rateLimit.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import * as list from './mailingList.service.js';

/**
 * The newsletter list: /v1/platform/mailing-list (mailingList.service.js).
 *
 *   POST /subscribe            public, rate-limited: { email, source }
 *   GET  /unsubscribe?token=   public: the link in every mail; answers with a
 *                              small page, since it is opened in a browser
 *   GET  /                     admins: search, source, from / to, status
 *   GET  /export.csv           admins: the same filters, as CSV
 */
const router = express.Router();

const fail = (res, err) => {
  const status = err?.statusCode || err?.status || 500;
  return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
};

router.post('/subscribe', mailingListRateLimiter, async (req, res) => {
  try {
    await list.subscribe({ email: req.body?.email, source: req.body?.source });
    return sendResponse(res, 200, 'You are subscribed', { subscribed: true });
  } catch (err) {
    return fail(res, err);
  }
});

router.get('/unsubscribe', mailingListRateLimiter, async (req, res) => {
  try {
    await list.unsubscribe(req.query.token);
    res.set('Cache-Control', 'no-store');
    return res
      .status(200)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Unsubscribed</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">'
        + '<h1 style="font-size:1.25rem">You are unsubscribed</h1><p>You will not get our newsletter any more.</p></body>');
  } catch (err) {
    return fail(res, err);
  }
});

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

router.get('/', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', await list.adminList(req.platformAdmin, req.query));
  } catch (err) {
    return fail(res, err);
  }
});

router.get('/export.csv', async (req, res) => {
  try {
    const csv = await list.adminExportCsv(req.platformAdmin, req.query);
    res.set('Content-Disposition', `attachment; filename="mail-list-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).type('text/csv').send(csv);
  } catch (err) {
    return fail(res, err);
  }
});

export default router;
