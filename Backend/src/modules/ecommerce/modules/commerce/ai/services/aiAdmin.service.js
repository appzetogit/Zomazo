import mongoose from 'mongoose';
import { AiConversation, AiUsageDaily } from '../models/aiConversation.model.js';
import { getAiSettings, effectiveModel } from './aiSettings.service.js';
import { tokensUsedThisMonth, dayKey } from './aiUsage.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const parseDate = (v, endOfDay = false) => {
    if (!v) return null;
    const s = String(v);
    const d = new Date(s.length === 10 ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d;
};

async function usersById(ids) {
    const valid = ids.filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
    if (!valid.length) return new Map();
    const users = await mongoose.connection.db.collection('users')
        .find({ _id: { $in: valid.map((id) => new mongoose.Types.ObjectId(String(id))) } })
        .project({ name: 1, phone: 1, email: 1 })
        .toArray();
    return new Map(users.map((u) => [String(u._id), { _id: u._id, name: u.name || '', phone: u.phone || '', email: u.email || '' }]));
}

/** Conversations, newest first. Filters: userId, from, to (YYYY-MM-DD or ISO). */
export async function listConversations(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const filter = {};
    if (query.userId) {
        if (!mongoose.Types.ObjectId.isValid(String(query.userId))) return { conversations: [], total: 0, page, limit };
        filter.userId = new mongoose.Types.ObjectId(String(query.userId));
    }
    const from = parseDate(query.from);
    const to = parseDate(query.to, true);
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    const [rows, total] = await Promise.all([
        AiConversation.aggregate([
            { $match: filter },
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
                $project: {
                    userId: 1, model: 1, totalTokens: 1, createdAt: 1, updatedAt: 1, supportTicketId: 1,
                    messageCount: { $size: '$messages' },
                    firstMessage: { $substrCP: [{ $ifNull: [{ $arrayElemAt: ['$messages.text', 0] }, ''] }, 0, 160] },
                },
            },
        ]),
        AiConversation.countDocuments(filter),
    ]);
    const users = await usersById(rows.map((r) => r.userId));
    return {
        conversations: rows.map((r) => ({
            ...r,
            anonymous: !r.userId,
            user: r.userId ? users.get(String(r.userId)) || null : null,
        })),
        total,
        page,
        limit,
    };
}

export async function getConversation(id) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
    const doc = await AiConversation.findById(id).select('-userKey').lean();
    if (!doc) return null;
    const users = await usersById([doc.userId]);
    return { ...doc, user: doc.userId ? users.get(String(doc.userId)) || null : null };
}

/** Tokens and estimated cost per day, plus the top users over the range. */
export async function getUsage(query = {}) {
    const settings = await getAiSettings({ fresh: true });
    const to = parseDate(query.to, true) || new Date();
    const from = parseDate(query.from) || new Date(to.getTime() - 29 * DAY_MS);
    const range = { day: { $gte: dayKey(from), $lte: dayKey(to) } };
    const inRate = (Number(settings.inputCostPer1M) || 0) / 1e6;
    const outRate = (Number(settings.outputCostPer1M) || 0) / 1e6;
    const round4 = (n) => Math.round(n * 10000) / 10000;
    const cost = (p, o) => round4(p * inRate + o * outRate);

    const [days, top] = await Promise.all([
        AiUsageDaily.aggregate([
            { $match: range },
            {
                $group: {
                    _id: '$day',
                    messages: { $sum: '$messages' },
                    llmCalls: { $sum: '$llmCalls' },
                    promptTokens: { $sum: '$promptTokens' },
                    outputTokens: { $sum: '$outputTokens' },
                    users: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        AiUsageDaily.aggregate([
            { $match: { ...range, userId: { $ne: null } } },
            { $group: { _id: '$userId', messages: { $sum: '$messages' }, promptTokens: { $sum: '$promptTokens' }, outputTokens: { $sum: '$outputTokens' } } },
            { $addFields: { tokens: { $add: ['$promptTokens', '$outputTokens'] } } },
            { $sort: { tokens: -1, messages: -1 } },
            { $limit: 10 },
        ]),
    ]);
    const users = await usersById(top.map((t) => t._id));
    const daily = days.map((d) => ({
        day: d._id,
        messages: d.messages,
        llmCalls: d.llmCalls,
        activeUsers: d.users,
        promptTokens: d.promptTokens,
        outputTokens: d.outputTokens,
        totalTokens: d.promptTokens + d.outputTokens,
        estimatedCostUsd: cost(d.promptTokens, d.outputTokens),
    }));
    const totals = daily.reduce((a, d) => ({
        messages: a.messages + d.messages,
        promptTokens: a.promptTokens + d.promptTokens,
        outputTokens: a.outputTokens + d.outputTokens,
        totalTokens: a.totalTokens + d.totalTokens,
        estimatedCostUsd: round4(a.estimatedCostUsd + d.estimatedCostUsd),
    }), { messages: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
    const monthTokens = await tokensUsedThisMonth();
    const budget = Number(settings.monthlyTokenBudget) || 0;
    return {
        from: dayKey(from),
        to: dayKey(to),
        model: effectiveModel(settings),
        rates: { inputCostPer1M: settings.inputCostPer1M, outputCostPer1M: settings.outputCostPer1M },
        daily,
        totals,
        month: {
            tokens: monthTokens,
            budget,
            remaining: budget ? Math.max(budget - monthTokens, 0) : null,
            exhausted: Boolean(budget) && monthTokens >= budget,
        },
        topUsers: top.map((t) => ({
            userId: t._id,
            user: users.get(String(t._id)) || null,
            messages: t.messages,
            tokens: t.tokens,
            estimatedCostUsd: cost(t.promptTokens, t.outputTokens),
        })),
    };
}
