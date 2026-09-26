import express from 'express';
import {
    refreshTokenController,
    requestSellerOtpController,
    verifySellerOtpController,
    logoutController,
    getMeController
} from './auth.controller.js';
import { authMiddleware } from './auth.middleware.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';

const router = express.Router();

// Only sellers sign in through this module.
//
// The source app also had user, delivery and admin logins here. Inside the
// platform those would be a second front door: a customer OTP'd in here would
// get an ecom_users account unlinked from their one platform identity, and an
// ecom_admins login would skip servicesAccess entirely. Customers use the
// platform's unified login (bridged by authMiddleware), admins the platform
// panel, and this vertical has no riders of its own.

// Seller OTP login
router.post('/seller/request-otp', authRateLimiter, requestSellerOtpController);
router.post('/seller/verify-otp', authRateLimiter, verifySellerOtpController);

// Refresh token (sellers' own refresh tokens)
router.post('/refresh-token', refreshTokenController);

// Logout (invalidates refresh token)
router.post('/logout', logoutController);

// Authenticated profile (requires Bearer token)
router.get('/me', authMiddleware, getMeController);

export default router;
