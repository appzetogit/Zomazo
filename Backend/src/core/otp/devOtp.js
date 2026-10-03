import { config } from '../../config/env.js';

/**
 * The one switch for every development OTP shortcut on the platform: a known
 * code instead of a random one, the code returned in the API response, test
 * phone numbers that take a fixed code, skipping the SMS gateway.
 *
 * It needs BOTH an explicit USE_DEFAULT_OTP=true and a non-production NODE_ENV.
 * NODE_ENV alone is not enough because env.js defaults it to 'development', so
 * a server started without it would have handed out codes to anyone who asked.
 * USE_DEFAULT_OTP alone is not enough because one stray flag on a live box
 * would open every account (validateEnv.js refuses that combination as well).
 *
 * The one exception: ALLOW_INSECURE_DEFAULT_OTP=true lets a production box run it
 * while SMS delivery is not set up yet. validateEnv.js warns on every boot while
 * both are on; remove both once SMS works. Admin password reset never takes the
 * fixed code in production, with or without it.
 *
 * Nothing should ever log an OTP value, even with this on: the code is
 * returned in the response when it is on, which is all local work needs.
 */
export const devOtpEnabled = () => config.useDefaultOtp === true
    && (config.nodeEnv !== 'production' || process.env.ALLOW_INSECURE_DEFAULT_OTP === 'true');
