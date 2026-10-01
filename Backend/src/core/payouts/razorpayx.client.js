import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../config/env.js';

/*
 * The thin RazorpayX HTTP layer: contacts, fund accounts, payouts, and the
 * webhook signature. Nothing here knows about withdrawals -- payout.service.js
 * owns the money rules.
 *
 * Every call goes through `send`, which tests replace with a fake so no test
 * ever reaches the real API.
 */

const BASE_URL = 'https://api.razorpay.com/v1';

export const isPayoutConfigured = () => Boolean(
    config.razorpayxKeyId
    && config.razorpayxKeySecret
    && config.razorpayxAccountNumber
    && config.razorpayxWebhookSecret
);

const defaultSend = async ({ method, path, data, headers }) => {
    const res = await axios.request({
        method,
        url: `${BASE_URL}${path}`,
        data,
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        auth: { username: config.razorpayxKeyId, password: config.razorpayxKeySecret },
        timeout: 20000,
        validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
};

let send = defaultSend;

/** Tests only: route every RazorpayX call to `fn({ method, path, data, headers })`. */
export const __setPayoutTransport = (fn) => { send = fn || defaultSend; };

/*
 * A 4xx means RazorpayX looked at the request and refused it -- nothing was
 * created, so the payout has definitely not gone out. Anything else (timeout,
 * 5xx, no answer) leaves us NOT knowing, and must never be treated as a failure
 * that returns the money: the transfer may still land.
 */
export class PayoutApiError extends Error {
    constructor(message, { status = 0, definitive = false, body = null } = {}) {
        super(message);
        this.status = status;
        this.definitive = definitive;
        this.body = body;
    }
}

const call = async (method, path, data, headers) => {
    let res;
    try {
        res = await send({ method, path, data, headers });
    } catch (err) {
        throw new PayoutApiError(`RazorpayX unreachable: ${err.message}`);
    }
    if (res.status >= 200 && res.status < 300) return res.data;
    const reason = res.data?.error?.description || `RazorpayX answered ${res.status}`;
    throw new PayoutApiError(reason, {
        status: res.status,
        definitive: res.status >= 400 && res.status < 500 && res.status !== 429,
        body: res.data,
    });
};

export const createContact = ({ name, email, phone, type, referenceId }) => call('POST', '/contacts', {
    name: String(name || 'Partner').slice(0, 50),
    ...(email ? { email } : {}),
    ...(phone ? { contact: String(phone) } : {}),
    type: type || 'vendor',
    reference_id: String(referenceId || '').slice(0, 40),
});

export const createFundAccount = ({ contactId, account }) => call('POST', '/fund_accounts', account.vpa
    ? { contact_id: contactId, account_type: 'vpa', vpa: { address: account.vpa } }
    : {
        contact_id: contactId,
        account_type: 'bank_account',
        bank_account: { name: account.holder, ifsc: account.ifsc, account_number: account.number },
    });

/*
 * IMPS is instant and runs round the clock, up to Rs 5 lakh. Above that NEFT.
 * A UPI fund account can only be paid by UPI.
 */
export const IMPS_LIMIT_RUPEES = 500000;
export const pickMode = ({ amountRupees, isVpa }) => {
    if (isVpa) return 'UPI';
    return amountRupees <= IMPS_LIMIT_RUPEES ? 'IMPS' : 'NEFT';
};

/*
 * The idempotency key is what makes a retried HTTP call safe: RazorpayX
 * returns the payout it already made for that key instead of a second one.
 */
export const createPayout = ({ fundAccountId, amountRupees, mode, referenceId, narration, notes, idempotencyKey }) => call(
    'POST',
    '/payouts',
    {
        account_number: config.razorpayxAccountNumber,
        fund_account_id: fundAccountId,
        amount: Math.round(Number(amountRupees) * 100),
        currency: 'INR',
        mode,
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: String(referenceId).slice(0, 40),
        narration: String(narration || 'ZOMAZO payout').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 30),
        notes: notes || {},
    },
    { 'X-Payout-Idempotency': String(idempotencyKey) },
);

export const fetchPayout = (payoutId) => call('GET', `/payouts/${encodeURIComponent(payoutId)}`);

/** HMAC-SHA256 of the raw request body with the webhook secret, compared in constant time. */
export const verifyWebhookSignature = (rawBody, signature) => {
    if (!config.razorpayxWebhookSecret || !rawBody || !signature) return false;
    const expected = crypto.createHmac('sha256', config.razorpayxWebhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
