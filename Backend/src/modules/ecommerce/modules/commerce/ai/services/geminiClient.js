import axios from 'axios';

/**
 * The one place that talks to the Gemini API. The key is read from
 * GEMINI_API_KEY and sent as a header (never in a URL, never logged or returned).
 */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

const defaultTransport = (url, body, options) => axios.post(url, body, options);
let transport = defaultTransport;

/** Tests swap the HTTP call out; pass nothing to restore it. */
export function setGeminiTransport(fn) {
    transport = typeof fn === 'function' ? fn : defaultTransport;
}

/**
 * generateContent. Returns { text, usage: { promptTokens, outputTokens }, model }.
 * Throws when there is no key or the call fails; callers fall back.
 */
export async function callGemini({ model, systemText, contents, generationConfig = {}, timeoutMs = 8000 }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini is not configured');
    const useModel = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:generateContent`;
    const body = {
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents,
        generationConfig,
    };
    const resp = await transport(url, body, { timeout: timeoutMs, headers: { 'x-goog-api-key': apiKey } });
    const data = resp?.data || {};
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p?.text || '').join('');
    const meta = data.usageMetadata || {};
    return {
        text,
        model: useModel,
        usage: {
            promptTokens: Number(meta.promptTokenCount) || 0,
            outputTokens: Number(meta.candidatesTokenCount) || 0,
        },
    };
}
