import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';
import { normalizePlatform } from '../../utils/platform.js';

const schema = z.object({
    // Optional on purpose: logging out must not be able to fail. A client with
    // an expired or cleared refresh token got a 400, so the fcmToken below was
    // never unregistered and a logged-out device kept getting pushes (the
    // platform's 26 Aug fix). null as well as absent for both.
    refreshToken: z.string().min(1, 'Refresh token is required').nullish(),
    fcmToken: z.string().nullish(),
    platform: z.preprocess(
        (value) => normalizePlatform(value, { allowUndefined: true }),
        z.enum(['web', 'mobile']).optional()
    )
});

export const validateLogoutDto = (body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
