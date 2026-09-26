import mongoose from 'mongoose';

const toolCallSchema = new mongoose.Schema(
    { name: { type: String, trim: true }, args: { type: mongoose.Schema.Types.Mixed, default: null } },
    { _id: false }
);

const messageSchema = new mongoose.Schema(
    {
        role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
        text: { type: String, default: '' },
        toolCalls: { type: [toolCallSchema], default: [] },
        promptTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        at: { type: Date, default: Date.now },
    },
    { _id: false }
);

/**
 * One assistant conversation. Removed by the TTL index once `expiresAt`
 * passes; expiresAt is pushed forward on every message by the retention setting.
 */
const aiConversationSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        /** userId, or "ip:<addr>" for signed-out visitors: what the daily cap counts against. */
        userKey: { type: String, default: '', index: true },
        messages: { type: [messageSchema], default: [] },
        promptTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        model: { type: String, default: '' },
        supportTicketId: { type: mongoose.Schema.Types.ObjectId, default: null },
        expiresAt: { type: Date, required: true },
    },
    { collection: 'ai_conversations', timestamps: true }
);

aiConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
aiConversationSchema.index({ createdAt: -1 });

export const AiConversation = mongoose.models.AiConversation || mongoose.model('AiConversation', aiConversationSchema);

/**
 * Per day and user counters: what the daily cap, the monthly budget and the
 * usage page read. `userKey` "system:search" holds smart-search fallback calls.
 */
const aiUsageDailySchema = new mongoose.Schema(
    {
        day: { type: String, required: true }, // YYYY-MM-DD (UTC)
        userKey: { type: String, required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, default: null },
        messages: { type: Number, default: 0 },
        llmCalls: { type: Number, default: 0 },
        promptTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
    },
    { collection: 'ai_usage_daily', timestamps: true }
);
aiUsageDailySchema.index({ day: 1, userKey: 1 }, { unique: true });

export const AiUsageDaily = mongoose.models.AiUsageDaily || mongoose.model('AiUsageDaily', aiUsageDailySchema);
