import { AiSettings } from '../models/aiSettings.model.js';
import { DEFAULT_MODEL, hasGeminiKey } from './geminiClient.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const EDITABLE = {
    enabled: 'boolean',
    model: 'string',
    systemPromptAddendum: 'string',
    dailyUserMessageCap: 'number',
    monthlyTokenBudget: 'number',
    retentionDays: 'number',
    inputCostPer1M: 'number',
    outputCostPer1M: 'number',
    searchLlmFallback: 'boolean',
};

let cached = null;
let cachedAt = 0;
const TTL_MS = 30 * 1000;

export function clearAiSettingsCache() {
    cached = null;
    cachedAt = 0;
}

/** The settings as plain values, created with defaults on first read. */
export async function getAiSettings({ fresh = false } = {}) {
    if (!fresh && cached && Date.now() - cachedAt < TTL_MS) return cached;
    let doc = await AiSettings.findOne({ key: 'default' }).lean();
    if (!doc) {
        doc = (await AiSettings.findOneAndUpdate(
            { key: 'default' },
            { $setOnInsert: { key: 'default' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean());
    }
    const { _id, __v, key, ...rest } = doc;
    cached = rest;
    cachedAt = Date.now();
    return cached;
}

/** The model to call: the admin's choice, else GEMINI_MODEL, else the default. */
export const effectiveModel = (settings) => settings?.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;

/**
 * What the admin API returns. Only whether a key is configured; never the key,
 * any part of it, or its length.
 */
export async function getAdminAiSettingsView() {
    const s = await getAiSettings({ fresh: true });
    return { ...s, effectiveModel: effectiveModel(s), apiKeyConfigured: hasGeminiKey() };
}

export async function updateAiSettings(body = {}) {
    const update = {};
    for (const [field, type] of Object.entries(EDITABLE)) {
        if (body[field] === undefined) continue;
        let v = body[field];
        if (type === 'boolean') v = v === true || v === 'true';
        else if (type === 'number') {
            v = Number(v);
            if (!Number.isFinite(v) || v < 0) throw new ValidationError(`${field} must be a non-negative number`);
        } else v = String(v ?? '').trim();
        update[field] = v;
    }
    if (update.retentionDays !== undefined && (update.retentionDays < 1 || update.retentionDays > 3650)) {
        throw new ValidationError('retentionDays must be between 1 and 3650');
    }
    if (update.model !== undefined && update.model && !/^[a-z0-9][a-z0-9.\-]{1,63}$/i.test(update.model)) {
        throw new ValidationError('model must be a Gemini model name such as gemini-2.5-flash');
    }
    if (update.systemPromptAddendum !== undefined && update.systemPromptAddendum.length > 2000) {
        throw new ValidationError('systemPromptAddendum must be at most 2000 characters');
    }
    await AiSettings.findOneAndUpdate({ key: 'default' }, { $set: update, $setOnInsert: { key: 'default' } }, { upsert: true, runValidators: true });
    clearAiSettingsCache();
    return getAdminAiSettingsView();
}
