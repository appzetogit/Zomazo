import { sendResponse, sendError } from '../../../../utils/response.js';
import { getAdminAiSettingsView, updateAiSettings } from '../services/aiSettings.service.js';
import { listConversations, getConversation, getUsage } from '../services/aiAdmin.service.js';

const wrap = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (e) {
        next(e);
    }
};

export const getSettings = wrap(async (_req, res) => sendResponse(res, 200, 'AI settings', await getAdminAiSettingsView()));
export const putSettings = wrap(async (req, res) => sendResponse(res, 200, 'AI settings saved', await updateAiSettings(req.body || {})));
export const listConversationsController = wrap(async (req, res) => sendResponse(res, 200, 'Conversations', await listConversations(req.query)));
export const getConversationController = wrap(async (req, res) => {
    const doc = await getConversation(req.params.id);
    if (!doc) return sendError(res, 404, 'Conversation not found');
    return sendResponse(res, 200, 'Conversation', { conversation: doc });
});
export const getUsageController = wrap(async (req, res) => sendResponse(res, 200, 'AI usage', await getUsage(req.query)));
