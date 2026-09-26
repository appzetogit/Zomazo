import express from 'express';
import { verifyAccessToken } from '../../../../core/auth/token.util.js';
import { chatAssistantController, linkHandoffController } from '../controllers/ai.controller.js';
import { aiChatRateLimiter } from '../../../../middleware/rateLimit.js';

const router = express.Router();

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7);
            const decoded = verifyAccessToken(token);
            if (decoded?.userId) {
                req.user = { userId: decoded.userId, role: decoded.role };
            }
        } catch (_) {
            // Non-blocking for AI chat
        }
    }
    next();
};

router.post('/chat', optionalAuth, aiChatRateLimiter, chatAssistantController);
// Records that a signed-in customer handed this conversation to support (ticket already created).
router.post('/handoff', optionalAuth, aiChatRateLimiter, linkHandoffController);

export default router;
