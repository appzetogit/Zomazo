import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { upload } from '../../middleware/upload.js';
import { loadAdminCached } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import * as spotlight from './spotlight.service.js';

/**
 * Partner ads (spotlight.service.js).
 *
 *   /v1/platform/spotlight             admins: GET / (list), PATCH /:id/review,
 *                                      PATCH /:id; public: GET /promoted
 *   <service partner mount>/spotlight  the partner's own requests, see
 *                                      partnerSpotlightRouter below
 *
 * Named "spotlight", not "ads": ad blockers abort requests whose URL says ad
 * or banner, and the screens then render empty with no error.
 */

const handle = (fn, message = 'OK', code = 200) => async (req, res) => {
  try {
    return sendResponse(res, code, message, await fn(req));
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
  }
};

const router = express.Router();

// Public: which businesses a list screen should pin as promoted. Cacheable for
// a minute -- the list changes only when an admin decides or a date passes.
router.get('/promoted', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60');
  next();
}, handle((req) => spotlight.promotedPartners(String(req.query.service || ''))));

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

router.get('/', handle((req) => spotlight.adminList(req.platformAdmin, req.query)));
router.get('/partners', handle((req) => spotlight.searchPartners(req.platformAdmin, req.query)));
// Multipart: service, kind, title, startDate, endDate, partnerId?, ctaLink?,
// description?, budgetNote?, image (needed for a banner).
router.post('/', upload.single('image'), handle(async (req) => ({
  item: await spotlight.adminCreate(req.platformAdmin, req.body || {}, req.file || null),
}), 'Ad created', 201));
router.patch('/:id/review', handle((req) => spotlight.adminReview(req.platformAdmin, req.params.id, req.body), 'Saved'));
router.patch('/:id', handle((req) => spotlight.adminUpdate(req.platformAdmin, req.params.id, req.body), 'Saved'));

export default router;

/**
 * A partner's own ad requests, mounted inside each service behind that
 * service's own sign-in (routes/index.js), so a Food restaurant, a Quick store
 * and a Shop seller each use the session they already have.
 *
 *   GET    /        my requests and ads
 *   POST   /        multipart: kind, title, startDate, endDate, ctaLink?,
 *                   description?, budgetNote?, image (needed for a banner)
 *   DELETE /:id     withdraw one still waiting for review
 */
export function partnerSpotlightRouter(service, role) {
  const r = express.Router();
  const me = (req) => req.user?.userId || req.user?.id;
  r.use((req, res, next) => (req.user?.role === role ? next() : sendError(res, 403, 'Partner access required')));
  r.get('/', handle(async (req) => ({ items: await spotlight.listOwn(service, me(req)) })));
  r.post('/', upload.single('image'), handle(async (req) => ({
    item: await spotlight.createRequest(service, me(req), req.body || {}, req.file || null),
  }), 'Request sent', 201));
  r.delete('/:id', handle((req) => spotlight.withdrawOwn(service, me(req), req.params.id), 'Withdrawn'));
  return r;
}
