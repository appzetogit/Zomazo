import express from 'express';
import { sendResponse, sendError } from '../../utils/response.js';
import {
  createCustomerTicket, listCustomerTickets, getCustomerTicket, replyCustomerTicket,
} from './customerSupport.service.js';

/**
 * The customer's help centre across every service (customerSupport.service.js).
 * Mounted at /v1/platform/me/support behind the customer auth in
 * routes/index.js, next to /v1/platform/me/orders.
 *
 *   GET  /tickets   every ticket the customer has raised, any service
 *   POST /tickets   { service, orderId?, issueType, description? }
 */
const router = express.Router();

const userId = (req) => req.user?.userId || req.user?.id;
const fail = (res, err, fallback) =>
  sendError(res, err?.statusCode && err.statusCode < 500 ? err.statusCode : 500, err?.statusCode && err.statusCode < 500 ? err.message : fallback);

router.get('/tickets', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', { tickets: await listCustomerTickets(userId(req)) });
  } catch (err) {
    return fail(res, err, 'Could not load your tickets. Please try again.');
  }
});

router.post('/tickets', async (req, res) => {
  try {
    return sendResponse(res, 201, 'Ticket raised', { ticket: await createCustomerTicket(userId(req), req.body || {}) });
  } catch (err) {
    return fail(res, err, 'Could not raise the ticket. Please try again.');
  }
});

// The conversation on one ticket, and the customer writing back. `key` is the
// list's `key` ("food:<id>", "shop:<id>", ...).
router.get('/tickets/:key', async (req, res) => {
  try {
    return sendResponse(res, 200, 'OK', { ticket: await getCustomerTicket(userId(req), req.params.key) });
  } catch (err) {
    return fail(res, err, 'Could not load the ticket. Please try again.');
  }
});

router.post('/tickets/:key/messages', async (req, res) => {
  try {
    return sendResponse(res, 201, 'Sent', { ticket: await replyCustomerTicket(userId(req), req.params.key, req.body || {}) });
  } catch (err) {
    return fail(res, err, 'Could not send. Please try again.');
  }
});

export default router;
