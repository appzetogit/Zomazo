import mongoose from 'mongoose';
import { AiConversation, AiUsageDaily } from '../models/aiConversation.model.js';
import { getAiSettings } from './aiSettings.service.js';

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const monthPrefix = (d = new Date()) => d.toISOString().slice(0, 7);

/** userId when signed in, else the caller's IP: what the daily cap counts. */
export const userKeyFor = ({ userId, ip }) => (userId ? String(userId) : `ip:${ip || 'unknown'}`);

export async function tokensUsedThisMonth(now = new Date()) {
    const [row] = await AiUsageDaily.aggregate([
        { $match: { day: { $regex: `^${monthPrefix(now)}` } } },
        { $group: { _id: null, t: { $sum: { $add: ['$promptTokens', '$outputTokens'] } } } },
    ]);
    return row?.t || 0;
}

/** True while the platform is under its monthly token budget (0 = no budget). */
export async function underMonthlyBudget(settings, now = new Date()) {
    const budget = Number(settings?.monthlyTokenBudget) || 0;
    if (!budget) return true;
    return (await tokensUsedThisMonth(now)) < budget;
}

/**
 * Whether this caller may send another message now.
 * { allowed: true } or { allowed: false, reason: 'disabled' | 'budget' | 'daily_cap', message }.
 */
export async function checkAssistantAllowed({ userKey, now = new Date() }) {
    const settings = await getAiSettings();
    if (!settings.enabled) {
        return { allowed: false, reason: 'disabled', message: 'The shopping assistant is turned off right now. You can still browse and search as usual.' };
    }
    if (!(await underMonthlyBudget(settings, now))) {
        return { allowed: false, reason: 'budget', message: 'The shopping assistant is taking a break for the rest of the month. Search and support are still available.' };
    }
    const cap = Number(settings.dailyUserMessageCap) || 0;
    if (cap) {
        const row = await AiUsageDaily.findOne({ day: dayKey(now), userKey }).select('messages').lean();
        if ((row?.messages || 0) >= cap) {
            return { allowed: false, reason: 'daily_cap', message: `You've reached today's limit of ${cap} assistant messages. It resets at midnight (UTC).` };
        }
    }
    return { allowed: true, settings };
}

export async function recordUsage({ userKey, userId = null, messages = 0, llmCalls = 0, promptTokens = 0, outputTokens = 0, now = new Date() }) {
    await AiUsageDaily.updateOne(
        { day: dayKey(now), userKey },
        {
            $inc: { messages, llmCalls, promptTokens, outputTokens },
            $setOnInsert: { userId: userId && mongoose.Types.ObjectId.isValid(String(userId)) ? new mongoose.Types.ObjectId(String(userId)) : null },
        },
        { upsert: true }
    );
}

const clip = (s, n) => String(s ?? '').slice(0, n);

/**
 * Appends one exchange to a conversation (creating it when conversationId is
 * missing or not the caller's) and pushes its expiry out by the retention setting.
 */
export async function appendExchange({ conversationId, userId, userKey, userText, reply, toolCalls = [], usage = {}, model = '', settings, now = new Date() }) {
    const retentionDays = Number(settings?.retentionDays) || 90;
    const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const promptTokens = Number(usage.promptTokens) || 0;
    const outputTokens = Number(usage.outputTokens) || 0;
    const msgs = [
        { role: 'user', text: clip(userText, 2000), at: now },
        { role: 'assistant', text: clip(reply, 8000), toolCalls, promptTokens, outputTokens, at: now },
    ];
    const update = {
        $push: { messages: { $each: msgs, $slice: -200 } },
        $inc: { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens },
        $set: { expiresAt, ...(model ? { model } : {}) },
    };
    if (conversationId && mongoose.Types.ObjectId.isValid(String(conversationId))) {
        const doc = await AiConversation.findOneAndUpdate({ _id: conversationId, userKey }, update, { new: true }).select('_id').lean();
        if (doc) return doc._id;
    }
    const created = await AiConversation.create({
        userId: userId && mongoose.Types.ObjectId.isValid(String(userId)) ? userId : null,
        userKey,
        messages: msgs,
        promptTokens,
        outputTokens,
        totalTokens: promptTokens + outputTokens,
        model,
        expiresAt,
    });
    return created._id;
}
