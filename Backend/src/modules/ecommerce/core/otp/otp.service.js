/**
 * Seller OTPs, through the platform's OTP service.
 *
 * The standalone app had its own copy: SMS credentials from env only, and a
 * per-phone limit of its own. The platform keeps SMS credentials in the
 * admin-editable profile and caps issuance per service in
 * core/otp/otpRateLimit.service.js, so a copy here would send nothing once the
 * keys moved to the panel, and would sit outside the platform's limits.
 *
 * The scope keeps these codes apart from any other code the same phone holds:
 * a seller who also runs a restaurant must not be able to verify one login with
 * the other's OTP.
 */
import {
    createOrUpdateOtp as createPlatformOtp,
    verifyOtp as verifyPlatformOtp,
} from '../../../../core/otp/otp.service.js';
import { OTP_SERVICES } from '../../../../core/otp/otpRateLimit.service.js';

const SCOPE = 'ecommerce';

export const createOrUpdateOtp = (phone) =>
    createPlatformOtp(phone, SCOPE, { service: OTP_SERVICES.ECOMMERCE });

export const verifyOtp = (phone, otp) => verifyPlatformOtp(phone, otp, SCOPE);
