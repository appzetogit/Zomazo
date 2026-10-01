import express from 'express';
import { sendResponse, sendError } from '../../utils/response.js';
import { convertPoints, getLoyaltySummary } from './loyalty.service.js';

/**
 * /v1/platform/me/loyalty: the signed-in customer's points (mounted behind the
 * customer auth in routes/index.js). The id in the token is the platform
 * account, the one the points and the wallet are kept on.
 */
const router = express.Router();

const handle = (fn, message = 'OK') => async (req, res) => {
  try {
    return sendResponse(res, 200, message, await fn(req));
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    return sendError(res, status, status >= 500 ? 'Could not complete that. Please try again.' : err.message);
  }
};

const me = (req) => req.user?.userId || req.user?.id;

router.get('/', handle((req) => getLoyaltySummary(me(req))));
router.post('/convert', handle((req) => convertPoints(me(req), req.body?.points), 'Points converted'));

export default router;
