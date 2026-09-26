import mongoose from 'mongoose';

/**
 * The assistant's admin-editable settings. One document (key "default").
 * The Gemini API key is NOT here: it stays in GEMINI_API_KEY.
 */
const aiSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        enabled: { type: Boolean, default: true },
        model: { type: String, trim: true, default: '' },
        systemPromptAddendum: { type: String, trim: true, default: '', maxlength: 2000 },
        /** Messages one user (or anonymous IP) may send per UTC day. 0 = unlimited. */
        dailyUserMessageCap: { type: Number, min: 0, default: 50 },
        /** Tokens the whole platform may spend per UTC month. 0 = unlimited. */
        monthlyTokenBudget: { type: Number, min: 0, default: 2_000_000 },
        retentionDays: { type: Number, min: 1, max: 3650, default: 90 },
        /** Used only for the usage page's cost estimate (USD per 1M tokens). */
        inputCostPer1M: { type: Number, min: 0, default: 0.3 },
        outputCostPer1M: { type: Number, min: 0, default: 2.5 },
        /** Let smart search ask the model when the rule parser finds nothing. */
        searchLlmFallback: { type: Boolean, default: false },
    },
    { collection: 'ai_settings', timestamps: true }
);

export const AiSettings = mongoose.models.AiSettings || mongoose.model('AiSettings', aiSettingsSchema);
