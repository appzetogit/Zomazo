import jwt from 'jsonwebtoken';
import crypto from 'crypto';
// The platform's config, not this module's: every vertical signs and verifies
// with ONE secret, so a customer's single login works here. This module's own
// env has no fallback when JWT_* is unset and would verify against `undefined`
// while the platform had generated a random secret -- every token rejected.
import { config } from '../../../../config/env.js';

export const signAccessToken = (payload) => {
    return jwt.sign(payload, config.jwtAccessSecret, {
        expiresIn: config.jwtAccessExpiresIn
    });
};

export const signRefreshToken = (payload) => {
    // jwtid makes two tokens minted in the same second differ. Without it the payload +
    // iat are identical and the unique index on refresh_tokens.token throws E11000
    // when a user double-taps "Verify".
    return jwt.sign(payload, config.jwtRefreshSecret, {
        expiresIn: config.jwtRefreshExpiresIn,
        jwtid: crypto.randomUUID()
    });
};

export const verifyAccessToken = (token) => {
    return jwt.verify(token, config.jwtAccessSecret);
};

export const verifyRefreshToken = (token) => {
    return jwt.verify(token, config.jwtRefreshSecret);
};

