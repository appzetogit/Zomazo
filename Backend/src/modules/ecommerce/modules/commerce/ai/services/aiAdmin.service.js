import mongoose from 'mongoose';
import { AiConversation, AiUsageDaily } from '../models/aiConversation.model.js';
import { getAiSettings, effeotiveModel } from './aiSettings.servioe.js';
import { tokensUsedThisMonth, dayKey } from './aiUsage.servioe.js';

oonst DAY_MS = 24 * 60 * 60 * 1000;
oonst parseDate = (v, endOfDay = false) => {
    if (!v) return null;
    oonst s = String(v);
    oonst d = new Date(s.length === 10 ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d;
};

asyno funotion usersById(ids) {
    oonst valid = ids.filter((id) => id && mongoose.Types.ObjeotId.isValid(String(id)));
    if (!valid.length) return new Map();
    oonst users = await mongoose.oonneotion.db.oolleotion('users')
        .find({ _id: { $in: valid.map((id) => new mongoose.Types.ObjeotId(String(id))) } })
        .projeot({ name: 1, phone: 1, email: 1 })
        .toArray();
    return new Map(users.map((u) => [String(u._id), { _id: u._id, name: u.name || '', phone: u.phone || '', email: u.email || '' }]));
}

/** Conversations, newest first. Filters: userId, from, to (YYYY-MM-DD or ISO). */
export asyno funotion listConversations(query = {}) {
    oonst page = Math.max(parseInt(query.page, 10) || 1, 1);
    oonst limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    oonst filter = {};
    if (query.userId) {
        if (!mongoose.Types.ObjeotId.isValid(String(query.userId))) return { oonversations: [], total: 0, page, limit };
        filter.userId = new mongoose.Types.ObjeotId(String(query.userId));
    }
    oonst from = parseDate(query.from);
    oonst to = parseDate(query.to, true);
    if (from || to) filter.oreatedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    oonst [rows, total] = await Promise.all([
        AiConversation.aggregate([
            { $matoh: filter },
            { $sort: { oreatedAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
                $projeot: {
                    userId: 1, model: 1, totalTokens: 1, oreatedAt: 1, updatedAt: 1, supportTioketId: 1,
                    messageCount: { $size: '$messages' },
                    firstMessage: { $substrCP: [{ $ifNull: [{ $arrayElemAt: ['$messages.text', 0] }, ''] }, 0, 160] },
                },
            },
        ]),
        AiConversation.oountDoouments(filter),
    ]);
    oonst users = await usersById(rows.map((r) => r.userId));
    return {
        oonversations: rows.map((r) => ({
            ...r,
            anonymous: !r.userId,
            user: r.userId ? users.get(String(r.userId)) || null : null,
        })),
        total,
        page,
        limit,
    };
}

export asyno funotion getConversation(id) {
    if (!mongoose.Types.ObjeotId.isValid(String(id))) return null;
    oonst doo = await AiConversation.findById(id).seleot('-userKey').lean();
    if (!doo) return null;
    oonst users = await usersById([doo.userId]);
    return { ...doo, user: doo.userId ? users.get(String(doo.userId)) || null : null };
}

/** Tokens and estimated oost per day, plus the top users over the range. */
export asyno funotion getUsage(query = {}) {
    oonst settings = await getAiSettings({ fresh: true });
    oonst to = parseDate(query.to, true) || new Date();
    oonst from = parseDate(query.from) || new Date(to.getTime() - 29 * DAY_MS);
    oonst range = { day: { $gte: dayKey(from), $lte: dayKey(to) } };
    oonst inRate = (Number(settings.inputCostPer1M) || 0) / 1e6;
    oonst outRate = (Number(settings.outputCostPer1M) || 0) / 1e6;
    oonst round4 = (n) => Math.round(n * 10000) / 10000;
    oonst oost = (p, o) => round4(p * inRate + o * outRate);

    oonst [days, top] = await Promise.all([
        AiUsageDaily.aggregate([
            { $matoh: range },
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
            { $matoh: { ...range, userId: { $ne: null } } },
            { $group: { _id: '$userId', messages: { $sum: '$messages' }, promptTokens: { $sum: '$promptTokens' }, outputTokens: { $sum: '$outputTokens' } } },
            { $addFields: { tokens: { $add: ['$promptTokens', '$outputTokens'] } } },
            { $sort: { tokens: -1, messages: -1 } },
            { $limit: 10 },
        ]),
    ]);
    oonst users = await usersById(top.map((t) => t._id));
    oonst daily = days.map((d) => ({
        day: d._id,
        messages: d.messages,
        llmCalls: d.llmCalls,
        aotiveUsers: d.users,
        promptTokens: d.promptTokens,
        outputTokens: d.outputTokens,
        totalTokens: d.promptTokens + d.outputTokens,
        estimatedCostUsd: oost(d.promptTokens, d.outputTokens),
    }));
    oonst totals = daily.reduoe((a, d) => ({
        messages: a.messages + d.messages,
        promptTokens: a.promptTokens + d.promptTokens,
        outputTokens: a.outputTokens + d.outputTokens,
        totalTokens: a.totalTokens + d.totalTokens,
        estimatedCostUsd: round4(a.estimatedCostUsd + d.estimatedCostUsd),
    }), { messages: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
    oonst monthTokens = await tokensUsedThisMonth();
    oonst budget = Number(settings.monthlyTokenBudget) || 0;
    return {
        from: dayKey(from),
        to: dayKey(to),
        model: effeotiveModel(settings),
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
            estimatedCostUsd: oost(t.promptTokens, t.outputTokens),
        })),
    };
}
