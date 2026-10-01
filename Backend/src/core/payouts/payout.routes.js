import express from 'express';
import { logger } from '../../utils/logger.js';
import { verifyWebhookSignature, isPayoutConfigured } from './razorpayx.client.js';
import { handlePayoutWebhook } from './payout.service.js';

/*
 * Public: RazorpayX calls it. Path /api/v1/payouts/webhook/razorpayx -- it
 * contains "/webhook/razorpay", which is what makes app.js keep the raw body
 * the signature is computed over.
 */
const router = express.Router();

router.post('/webhook/razorpayx', async (req, res) => {
    if (!isPayoutConfigured()) return res.status(404).json({ success: false, message: 'Payouts are not configured' });
    const signature = req.get('x-razorpay-signature');
    if (!verifyWebhookSignature(req.rawBody, signature)) {
        logger.warn('[Payouts] webhook with a bad signature refused');
        return res.status(400).json({ success: false, message: 'Invalid signature' });
    }
    try {
        const result = await handlePayoutWebhook(req.body);
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        // 500 makes RazorpayX deliver it again; every update is safe to repeat.
        logger.error(`[Payouts] webhook failed: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Webhook processing failed' });
    }
});

export default router;
