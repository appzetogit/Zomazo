import express from 'express';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendResponse } from '../../utils/response.js';
import { businessesForPhone, handOffTo, phoneFromPass } from './partnerHandoff.service.js';

/*
 * A partner's businesses across services, and opening one without another OTP
 * (partnerHandoff.service.js). Authorised by the partner pass, sent as the
 * X-Partner-Pass header -- not by a service session, whose phone proves nothing.
 */
const router = express.Router();
const passOf = (req) => req.get('x-partner-pass') || '';

router.get('/businesses', asyncHandler(async (req, res) => {
  const items = await businessesForPhone(phoneFromPass(passOf(req)));
  return sendResponse(res, 200, 'Your businesses', { items });
}));

router.post('/handoff', authRateLimiter, asyncHandler(async (req, res) => {
  const result = await handOffTo({ pass: passOf(req), kind: String(req.body?.kind || ''), id: String(req.body?.id || '') });
  return sendResponse(res, 200, 'Signed in', result);
}));

export default router;
