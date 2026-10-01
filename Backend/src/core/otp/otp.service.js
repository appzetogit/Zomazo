import crypto from 'crypto';
import { smsCredentials } from '../settings/platformProfile.service.js';
import ms from 'ms';
import { FoodOtp } from './otp.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../auth/errors.js';
import { consumeOtpQuota, otpRateLimitMessage, OTP_SERVICES } from './otpRateLimit.service.js';

// How many digits a new code has. 6 is the target; it is a setting because every
// web OTP screen still has four boxes, and flipping the backend alone would lock
// everyone out. Verification does not care about length, so codes issued before a
// flip keep working until they expire.
const otpLength = () => (Number(config.otpLength) === 6 ? 6 : 4);

const generateOtpCode = () => {
    const len = otpLength();
    return String(crypto.randomInt(10 ** (len - 1), 10 ** len));
};

// The code is a sign-in credential, so the row keeps only a keyed hash of it: a
// database dump or a support query no longer hands out live codes. The phone and
// scope are mixed in so a hash cannot be replayed onto another row.
const hashOtp = (code, { phone, scope, salt }) =>
    crypto
        .createHmac('sha256', String(config.jwtAccessSecret || ''))
        .update(`${phone}|${scope}|${salt}|${String(code ?? '').trim()}`)
        .digest('hex');

const sameHash = (a, b) => {
    const x = Buffer.from(String(a || ''), 'hex');
    const y = Buffer.from(String(b || ''), 'hex');
    return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

const normalizeOtpPhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '').trim();
    if (digits.length === 12 && digits.startsWith('91')) {
        return digits.slice(2);
    }
    return digits.slice(-10);
};

// No fallback scope: a code issued for one login (say a restaurant) must never
// verify another (a customer), so a caller that forgets the scope is a bug.
const normalizeOtpScope = (scope) => String(scope || '').trim().toLowerCase();

/**
 * Sends SMS via SMS India Hub API
 * @param {string} phone - 10-digit mobile number (will be prefixed with 91)
 * @param {string} otp
 */
/** The wording this file used to hard-code. Kept as the fallback, so an unset
 *  SMS_INDIA_HUB_TEMPLATE_TEXT changes nothing about what is sent. */
export const DEFAULT_OTP_SMS_TEMPLATE =
    'Welcome to the Quick Drop powered by SMSINDIAHUB. Your OTP for registration is {{OTP}}';

/**
 * The message body, rendered from the DLT-registered template.
 *
 * SMS India Hub rejects anything that is not character-for-character the
 * registered template (ErrorCode 006), so the wording is configuration rather
 * than source and lives in SMS_INDIA_HUB_TEMPLATE_TEXT.
 *
 * Returns null for a template that would not carry the code -- sending an OTP
 * message with no OTP in it costs money, tells the user nothing, and looks like
 * the gateway working.
 */
export function buildOtpSmsMessage({ otp, expiryMinutes, template } = {}) {
    const raw = String(template || '').trim() || DEFAULT_OTP_SMS_TEMPLATE;
    const message = raw
        .replace(/\{\{\s*OTP\s*\}\}/gi, String(otp ?? ''))
        .replace(/\{\{\s*MINUTES\s*\}\}/gi, String(expiryMinutes ?? ''));
    if (!String(otp ?? '') || !message.includes(String(otp))) return null;
    return message;
}

const sendSmsViaIndiaHub = async (phone, otp) => {
    try {
        // Normalize phone: strip non-digits, ensure 91 country code prefix
        const digits = String(phone || '').replace(/\D/g, '');
        const msisdn = digits.startsWith('91') ? digits : `91${digits}`;

        const expiryMinutes = Math.max(
            1,
            Math.round(
                (config.otpExpirySeconds
                    ? config.otpExpirySeconds
                    : (config.otpExpiryMinutes || 5) * 60) / 60,
            ),
        );
        // Master settings if saved there, else .env.
        const sms = smsCredentials();
        const message = buildOtpSmsMessage({
            otp,
            expiryMinutes,
            template: sms.templateText,
        });
        if (!message) {
            logger.error(
                '[SMS] SMS_INDIA_HUB_TEMPLATE_TEXT has no {{OTP}} placeholder, so the message '
                + 'would carry no code. Not sending — fix the template.',
            );
            return;
        }

        // SMS India Hub HTTP GET API — query param names are case-sensitive per SOP
        const url = new URL(
            String(config.smsIndiaHubUrl || '').trim()
                || 'http://cloud.smsindiahub.in/vendorsms/pushsms.aspx',
        );
        url.searchParams.append('APIKey', sms.apiKey);
        url.searchParams.append('sid', sms.senderId);
        url.searchParams.append('msisdn', msisdn);
        url.searchParams.append('msg', message);
        url.searchParams.append('gwid', String(config.smsIndiaHubGwid || '2').trim() || '2');
        url.searchParams.append('fl', '0');
        if (config.smsIndiaHubUsername) {
            url.searchParams.append('uname', config.smsIndiaHubUsername);
        }
        if (sms.templateId) {
            url.searchParams.append('DLT_TE_ID', sms.templateId);
        }

        logger.info(`[SMS] Sending OTP to ${msisdn} via SMS India Hub...`);
        // Bounded, because the caller is a user waiting on a sign-in request and
        // the gateway is a third party that can simply stop answering.
        const response = await fetch(url.toString(), {
            signal: AbortSignal.timeout(config.smsIndiaHubTimeoutMs || 15000),
        });
        const resultText = await response.text();
        logger.info(`[SMS] Raw response for ${msisdn}: ${resultText}`);

        // SMS India Hub often returns HTTP 200 OK even for errors — check response body
        let parsed = null;
        try { parsed = JSON.parse(resultText); } catch (_) { /* plain text response is OK */ }

        if (parsed && parsed.ErrorCode && parsed.ErrorCode !== '000') {
            const errMsg = `SMS India Hub ERROR for ${phone}: [${parsed.ErrorCode}] ${parsed.ErrorMessage || resultText}`;
            logger.error(errMsg);
            // eslint-disable-next-line no-console
            console.error(`❌ [SMS ERROR] ${errMsg}`);
            if (parsed.ErrorCode === '006') {
                // eslint-disable-next-line no-console
                console.error('❌ [SMS ERROR] ErrorCode 006 = DLT Template mismatch. The message text must EXACTLY match your registered TRAI DLT template. Login to https://cloud.smsindiahub.in and verify the approved template text.');
            }
        } else if (!response.ok) {
            logger.error(`SMS API HTTP error for ${phone}: ${response.status} – ${resultText}`);
        } else {
            logger.info(`✅ SMS sent successfully to ${msisdn}`);
        }
    } catch (error) {
        logger.error(`Error sending SMS to ${phone}: ${error.message}`);
        // Do NOT throw — OTP is already stored in DB; SMS failure should not block the flow
    }
};

/**
 * @param {string} phone
 * @param {string} [scope]    keeps one vertical's OTPs from overwriting another's
 *                            for the same phone. Quick commerce uses `qc:*`.
 * @param {{service?: string}} [opts]  which service to ATTRIBUTE the request to.
 *                            The budget is shared per phone either way -- this only
 *                            decides what the rate-limit row is labelled, and a
 *                            quick-commerce request logged as food is a support
 *                            question nobody can answer.
 */
export const createOrUpdateOtp = async (phone, scope, { service = OTP_SERVICES.FOOD } = {}) => {
    const normalizedPhone = normalizeOtpPhone(phone);
    const normalizedScope = normalizeOtpScope(scope);
    if (!normalizedPhone || normalizedPhone.length < 8) {
        throw new ValidationError('A valid phone number is required');
    }
    if (!normalizedScope) {
        throw new Error('createOrUpdateOtp needs a scope');
    }

    const existing = await FoodOtp.findOne({ phone: normalizedPhone, scope: normalizedScope })
        .sort({ createdAt: -1 });
    const now = new Date();

    // A code that took too many wrong guesses stays locked until it expires.
    // Without this, asking for a new code would reset the counter and hand a
    // guesser a fresh set of tries every time.
    if (existing && existing.attempts >= config.otpMaxAttempts && existing.expiresAt > now) {
        const minutes = Math.max(1, Math.ceil((existing.expiresAt - now) / 60000));
        throw new ValidationError(`Too many wrong OTP attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }

    // Platform-wide rate limit. Replaces the old per-scope counter below: that let one
    // phone pull a full quota from each scope (user / restaurant / delivery), and did
    // nothing about the same number also hitting taxi and service-provider.
    const quota = await consumeOtpQuota(phone, { service });
    if (!quota.allowed) {
        throw new ValidationError(otpRateLimitMessage(quota));
    }

    // requestCount is still maintained on the OTP record for support/debugging, but it
    // is no longer what enforces the limit.
    if (existing) {
        const windowMs = (config.otpRateWindow || 600) * 1000;
        existing.requestCount = now - existing.lastRequestAt < windowMs ? existing.requestCount + 1 : 1;
    }

    let otp;
    if (config.useDefaultOtp) {
        otp = otpLength() === 6 ? '123456' : '1234';
        logger.info(`Default OTP mode enabled – OTP is ${otp} for phone ${normalizedPhone}`);
    } else {
        otp = generateOtpCode();
    }

    // Dev debugging: print the generated OTP so local sign-in works without SMS.
    //
    // Never in production: an OTP in the log is a sign-in credential, so anyone with
    // log access (pm2 logs, a shipped log aggregator, a support screenshot) could take
    // over any account that requested one. Production logs the request, not the code.
    if (config.nodeEnv !== 'production') {
        logger.info(`[OTP DEBUG] Generated OTP ${otp} for phone ${normalizedPhone}`);
        // eslint-disable-next-line no-console
        console.log(`[OTP DEBUG] Generated OTP ${otp} for phone ${normalizedPhone}`);
    } else {
        logger.info(`[OTP] Issued OTP for phone ${normalizedPhone} scope ${normalizedScope}`);
    }

    // Expiry calculation: prioritize seconds, then minutes, then fallback to MS string
    let ttlMs;
    if (config.otpExpirySeconds) {
        ttlMs = config.otpExpirySeconds * 1000;
    } else if (config.otpExpiryMinutes) {
        ttlMs = config.otpExpiryMinutes * 60 * 1000;
    } else {
        ttlMs = ms(config.otpExpiry || '5m');
    }
    const expiresAt = new Date(now.getTime() + ttlMs);

    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOtp(otp, { phone: normalizedPhone, scope: normalizedScope, salt });

    if (existing) {
        existing.otp = undefined;
        existing.otpHash = otpHash;
        existing.salt = salt;
        existing.expiresAt = expiresAt;
        existing.attempts = 0;
        existing.lastRequestAt = now;
        await existing.save();
    } else {
        await FoodOtp.create({
            phone: normalizedPhone, 
            scope: normalizedScope,
            otpHash,
            salt,
            expiresAt,
            requestCount: 1,
            lastRequestAt: now
        });
    }

    // Only send SMS if not in default OTP mode
    if (!config.useDefaultOtp) {
        await sendSmsViaIndiaHub(normalizedPhone, otp);
    }

    return otp;
};

export const verifyOtp = async (phone, otp, scope) => {
    const normalizedPhone = normalizeOtpPhone(phone);
    const normalizedScope = normalizeOtpScope(scope);
    if (!normalizedPhone || normalizedPhone.length < 8) {
        return { valid: false, reason: 'Invalid phone format' };
    }
    if (!normalizedScope) {
        return { valid: false, reason: 'OTP scope required' };
    }

    const otpStr = String(otp ?? '').trim();

    // ── Development sign-in shortcuts ──────────────────────────────────────────
    //
    // All three of these return { valid: true } WITHOUT comparing against the issued
    // OTP, so each one is an authentication bypass. They exist so local development
    // and QA do not need working SMS delivery.
    //
    // The whole block is gated on NODE_ENV !== 'production', matching how the very
    // same default phone numbers are already gated in core/auth/auth.service.js.
    // Until this gate existed the fallbacks below ("7974161582" / "1234") applied in
    // every environment, so anyone who read them out of the source could sign in as
    // those accounts on the live system.
    //
    // Do not add a bypass outside this guard, and do not widen the guard to include
    // config.useDefaultOtp: that flag is an SMS-delivery switch, not an environment.
    // Treating it as one is exactly what made this reachable in production.
    if (config.nodeEnv !== 'production') {
        // 1. Static OTP bypass from environment variables
        const staticPhone = process.env.STATIC_OTP_PHONE ? normalizeOtpPhone(process.env.STATIC_OTP_PHONE) : null;
        const staticCode = process.env.STATIC_OTP_CODE ? String(process.env.STATIC_OTP_CODE).trim() : null;
        if (staticPhone && staticCode && normalizedPhone === staticPhone && otpStr === staticCode) {
            logger.info(`[OTP VERIFY] Static OTP bypass matched for phone=${normalizedPhone} scope=${normalizedScope}`);
            return { valid: true };
        }

        // 2. Default credentials bypass (user, restaurant, delivery)
        const defaultRestaurantPhone = normalizeOtpPhone(process.env.DEFAULT_RESTAURANT_PHONE || "7974161582");
        const defaultUserPhone = normalizeOtpPhone(process.env.DEFAULT_USER_PHONE || "7974161582");
        const defaultDeliveryPhone = normalizeOtpPhone(process.env.DEFAULT_DELIVERY_PHONE || "7610416911");

        const isDefaultPhoneNum = normalizedPhone === defaultRestaurantPhone ||
                                   normalizedPhone === defaultUserPhone ||
                                   normalizedPhone === defaultDeliveryPhone;

        if (isDefaultPhoneNum && (otpStr === '1234' || otpStr === '123456')) {
            logger.info(`[OTP VERIFY] Default credentials bypass matched for phone=${normalizedPhone} scope=${normalizedScope}`);
            return { valid: true };
        }

        // 3. Default OTP bypass ('1234') when useDefaultOtp is enabled
        if (config.useDefaultOtp && otpStr === '1234') {
            logger.info(`[OTP VERIFY] Default OTP bypass ('1234') matched for phone=${normalizedPhone} scope=${normalizedScope}`);
            return { valid: true };
        }
    }

    // Count the guess and read the row in ONE write. The old read, compare, then
    // fire-and-forget save let twenty parallel guesses all see attempts=0, so the
    // limit counted almost nothing. Here a guess past the limit matches no row.
    const now = new Date();
    const record = await FoodOtp.findOneAndUpdate(
        {
            phone: normalizedPhone,
            scope: normalizedScope,
            attempts: { $lt: config.otpMaxAttempts },
            expiresAt: { $gt: now },
        },
        { $inc: { attempts: 1 } },
        { new: true, sort: { createdAt: -1 } },
    );
    if (!record) {
        const any = await FoodOtp.findOne({ phone: normalizedPhone, scope: normalizedScope })
            .sort({ createdAt: -1 })
            .select('expiresAt attempts')
            .lean();
        if (!any) return { valid: false, reason: 'OTP not found' };
        if (any.expiresAt <= now) return { valid: false, reason: 'OTP expired' };
        return { valid: false, reason: 'Max attempts exceeded' };
    }

    // Rows written before codes were hashed have no hash; they expire within
    // minutes, and asking for a new code replaces them.
    const candidate = hashOtp(otpStr, { phone: normalizedPhone, scope: normalizedScope, salt: record.salt });
    if (!record.otpHash || !sameHash(candidate, record.otpHash)) {
        return { valid: false, reason: 'Invalid OTP' };
    }

    // Consume it in the same step that confirms it is still there. Two requests
    // carrying the right code race here, and only one gets the row back, so a
    // code signs in once. Matching the hash also stops a just-resent code being
    // eaten by a request that guessed the previous one.
    const consumed = await FoodOtp.findOneAndDelete({ _id: record._id, otpHash: record.otpHash });
    if (!consumed) {
        return { valid: false, reason: 'OTP already used' };
    }
    return { valid: true };
};
