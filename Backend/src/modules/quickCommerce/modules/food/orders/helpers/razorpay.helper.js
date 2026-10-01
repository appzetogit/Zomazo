import crypto from 'crypto';
import { safeSignatureEqual } from '../../../../../../utils/safeCompare.js'; // master's util: one copy, the QC fork already drifts enough

let Razorpay;
try {
    const mod = await import('razorpay');
    Razorpay = mod.default;
} catch {
    Razorpay = null;
}

import { config } from '../../../../config/env.js';

// Master settings if saved there, else .env (core/settings/platformProfile.service.js).
import { razorpayKeyId, razorpayKeySecret } from '../../../../../../core/settings/platformProfile.service.js';

export function isRazorpayConfigured() {
    return Boolean(razorpayKeyId() && razorpayKeySecret() && Razorpay);
}

export function getRazorpayKeyId() {
    return razorpayKeyId();
}

export function getRazorpayInstance() {
    if (!isRazorpayConfigured()) return null;
    return new Razorpay({ key_id: razorpayKeyId(), key_secret: razorpayKeySecret() });
}

export function createRazorpayOrder(amountPaise, currency = 'INR', receipt = '') {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.orders.create({
        amount: Math.round(amountPaise),
        currency,
        receipt: receipt || undefined
    });
}

export function createPaymentLink({ amountPaise, currency = 'INR', description, orderId, customerName, customerEmail, customerPhone }) {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.paymentLink.create({
        amount: Math.round(amountPaise),
        currency,
        description: description || `Order ${orderId}`,
        customer: {
            name: customerName || 'Customer',
            email: customerEmail || 'customer@example.com',
            contact: customerPhone ? String(customerPhone).replace(/\D/g, '').slice(-10) : '9999999999'
        }
    });
}

export function verifyPaymentSignature(orderId, paymentId, signature) {
    if (!razorpayKeySecret()) return false;
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac('sha256', razorpayKeySecret()).update(body).digest('hex');
    return safeSignatureEqual(expected, String(signature || ""));
}

/**
 * Fetch Razorpay payment (server-side) for additional validation (amount/status/order match).
 * @param {string} paymentId
 */
export async function fetchRazorpayPayment(paymentId) {
    const instance = getRazorpayInstance();
    if (!instance) throw new Error('Razorpay not configured');
    if (!paymentId) throw new Error('paymentId is required');
    return instance.payments.fetch(String(paymentId));
}

/**
 * Fetch Razorpay payment-link to check status (used for Razorpay QR auto verification).
 * @param {string} paymentLinkId
 */
export async function fetchRazorpayPaymentLink(paymentLinkId) {
    const instance = getRazorpayInstance();
    if (!instance) throw new Error('Razorpay not configured');
    if (!paymentLinkId) throw new Error('paymentLinkId is required');
    return instance.paymentLink.fetch(String(paymentLinkId));
}

/**
 * ✅ NEW: Initiate a refund for a successful payment.
 * NON-BREAKING Extension for automated cancellation refunds.
 * @param {string} paymentId - Original Razorpay payment_id (captured)
 * @param {number} amount - Amount to refund (in major unit, e.g., INR 123.45)
 */
export async function initiateRazorpayRefund(paymentId, amount, { key = '', reason = '' } = {}) {
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay is not configured on this server');
    }
    const instance = getRazorpayInstance();
    try {
        const refund = await instance.payments.refund(paymentId, {
            amount: Math.round(Number(amount) * 100), // convert to paise
            // `key` tags an admin refund so a takeover can find it again
            // (findRazorpayRefundByKey) instead of paying it a second time.
            ...(key ? { receipt: String(key).slice(0, 40) } : {}),
            notes: {
                reason: reason ? String(reason).slice(0, 250) : 'Order cancelled by system flow',
                ...(key ? { refund_key: key } : {}),
                at: new Date().toISOString()
            }
        });
        return {
            success: true,
            refundId: refund.id,
            status: refund.status || 'processed',
            raw: refund
        };
    } catch (err) {
        // Log locally but pass the error to the service to handle status update
        console.error(`Razorpay Refund API Failure [PaymentId: ${paymentId}]:`, err?.message || err);
        return {
            success: false,
            error: err?.message || 'Razorpay refund API error',
            status: 'failed'
        };
    }
}

/**
 * A refund already made on this payment under an admin refund's key, or null.
 * Used before re-paying a refund whose claim was left behind by a crash.
 * Throws when the gateway cannot be asked: not knowing is not "not refunded".
 */
export async function findRazorpayRefundByKey(paymentId, key) {
    if (!isRazorpayConfigured()) throw new Error('Razorpay is not configured on this server');
    const list = await getRazorpayInstance().payments.fetchMultipleRefund(paymentId, { count: 100 });
    const hit = (list?.items || []).find((r) => r?.notes?.refund_key === key || r?.receipt === String(key).slice(0, 40));
    return hit ? { refundId: hit.id } : null;
}
