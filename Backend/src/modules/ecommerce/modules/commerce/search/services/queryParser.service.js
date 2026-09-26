import { Attribute } from '../../admin/models/attribute.model.js';
import { Category } from '../../admin/models/category.model.js';
import { Product } from '../../admin/models/product.model.js';
import { getAiSettings, effectiveModel } from '../../ai/services/aiSettings.service.js';
import { underMonthlyBudget, recordUsage } from '../../ai/services/aiUsage.service.js';
import { callGemini, hasGeminiKey } from '../../ai/services/geminiClient.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Smart search: turns "red tshirt under 500 size M" or "5kg atta" into the
 * structured filters productSearch already understands.
 *
 * Rules first (prices, pack sizes, and the attribute values, brands and
 * categories that exist in the DB). Only when the rules find nothing, and the
 * admin has switched it on, is Gemini asked, with a strict JSON schema whose
 * answer is checked against the same vocabulary before any of it is used.
 */

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Loose key for matching category names: "T-Shirts" = "tshirt". */
const looseKey = (s) => norm(s).replace(/\s+/g, '').replace(/(es|s)$/, '');

/* ------------------------------------------------------------------ units */

const UNIT_ALIASES = [
    ['kg', ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms']],
    ['g', ['g', 'gm', 'gms', 'gram', 'grams', 'gramme', 'grm']],
    ['l', ['l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'lit']],
    ['ml', ['ml', 'mls', 'millilitre', 'milliliter']],
    ['pcs', ['pc', 'pcs', 'piece', 'pieces', 'pack', 'packs']],
];
const UNIT_OF = new Map(UNIT_ALIASES.flatMap(([unit, list]) => list.map((a) => [a, unit])));
const UNIT_WORDS = [...UNIT_OF.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
/** "5kg", "5 kg", "1.5 litre", "500gm", "5 kilo" */
const PACK_RX = new RegExp(`(?<![\\p{L}\\p{N}.])(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})(?![\\p{L}\\p{N}])`, 'iu');

/** "5kg" -> { value: 5, unit: 'kg', label: '5 kg' } */
export function parsePackSize(amount, unitWord) {
    const unit = UNIT_OF.get(String(unitWord).toLowerCase());
    const value = Number(amount);
    if (!unit || !Number.isFinite(value) || value <= 0) return null;
    return { value, unit, label: `${value} ${unit === 'l' ? 'L' : unit}` };
}

/** A regex matching how sellers write that pack size: "5kg", "5 Kg", "5 kgs", "5.0 kilo". */
export function packSizeRegex(packSize) {
    const m = String(packSize || '').match(PACK_RX);
    const parsed = m && parsePackSize(m[1], m[2]);
    if (!parsed) return null;
    const aliases = UNIT_ALIASES.find(([u]) => u === parsed.unit)[1].map(escapeRegex).join('|');
    const num = escapeRegex(String(parsed.value)).replace(/$/, '(?:\\.0+)?');
    return new RegExp(`(^|[^\\d.])${num}\\s*(${aliases})\\b`, 'i');
}

/* ----------------------------------------------------------------- prices */

const CUR = '(?:₹|rs\\.?|inr|rupees?)?\\s*';
const AMOUNT = '(\\d{1,3}(?:,\\d{2,3})+|\\d+(?:\\.\\d+)?)(k(?![a-z]))?';
const AFTER = '(?:\\s*(?:₹|rs\\.?|inr|rupees?|\\/-))?';
const toAmount = (digits, k) => {
    const n = Number(String(digits).replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    return k ? n * 1000 : n;
};

const PRICE_PATTERNS = [
    // between 200 and 400 / from 200 to 400 / 200-400 / 200 to 400 rs
    { rx: new RegExp(`\\b(?:between|from)\\s+${CUR}${AMOUNT}${AFTER}\\s*(?:and|to|-|–)\\s*${CUR}${AMOUNT}${AFTER}`, 'i'), kind: 'range' },
    { rx: new RegExp(`(?:^|\\s)${CUR}${AMOUNT}${AFTER}\\s*(?:-|–|to)\\s*${CUR}${AMOUNT}${AFTER}(?=\\s|$)`, 'i'), kind: 'range', needsCurrencyOrBig: true },
    // under 500 / below ₹1,000 / less than 1k / upto 300 / within 999 / max 500 / < 500
    { rx: new RegExp(`(?:\\b(?:under|below|less\\s+than|lesser\\s+than|upto|up\\s+to|within|max(?:imum)?|not\\s+more\\s+than|cheaper\\s+than)\\b|<=?)\\s*${CUR}${AMOUNT}${AFTER}`, 'i'), kind: 'max' },
    // above 500 / over 1k / more than 200 / min 300 / > 300 / starting 200
    { rx: new RegExp(`(?:\\b(?:above|over|more\\s+than|greater\\s+than|min(?:imum)?|starting(?:\\s+(?:at|from))?|at\\s+least)\\b|>=?)\\s*${CUR}${AMOUNT}${AFTER}`, 'i'), kind: 'min' },
    // Hindi-ish: "500 ke neeche", "500 se kam", "500 tak" / "500 se upar", "500 se zyada"
    { rx: new RegExp(`${CUR}${AMOUNT}${AFTER}\\s*(?:ke|se|k)?\\s*(?:neeche|niche|kam|tak|andar|ander)\\b`, 'i'), kind: 'max' },
    { rx: new RegExp(`${CUR}${AMOUNT}${AFTER}\\s*(?:ke|se|k)?\\s*(?:upar|uper|zyada|jyada|ziada)\\b`, 'i'), kind: 'min' },
];

/* ------------------------------------------------------------ vocabulary */

let vocabCache = null;
let vocabAt = 0;
const VOCAB_TTL_MS = 10 * 60 * 1000;

export function clearQueryVocabularyCache() {
    vocabCache = null;
    vocabAt = 0;
    llmCache.clear();
}

/**
 * What the parser can recognise: attribute values (from the admin's
 * attributes), brands (from approved products) and categories.
 */
export async function loadVocabulary() {
    if (vocabCache && Date.now() - vocabAt < VOCAB_TTL_MS) return vocabCache;
    const [attributes, brands, categories] = await Promise.all([
        Attribute.find({ isActive: { $ne: false } }).select('name type values.value').lean(),
        Product.distinct('brand', { approvalStatus: 'approved', brand: { $nin: [null, ''] } }),
        Category.find({ isActive: { $ne: false } }).select('_id name').limit(2000).lean(),
    ]);
    vocabCache = {
        attributes: attributes.map((a) => ({
            name: a.name,
            type: a.type,
            values: (a.values || []).map((v) => v.value).filter(Boolean),
        })),
        brands: brands.filter(Boolean).slice(0, 5000),
        categories: categories.map((c) => ({ id: String(c._id), name: c.name })),
    };
    vocabAt = Date.now();
    return vocabCache;
}

/* ----------------------------------------------------------------- parser */

const FILLER = new Set([
    'find', 'show', 'me', 'search', 'for', 'buy', 'get', 'looking', 'want', 'need', 'i', 'a', 'an', 'the',
    'with', 'in', 'of', 'please', 'pls', 'some', 'price', 'priced', 'rs', 'inr', 'rupees', 'rupee', 'size',
    'colour', 'color', 'brand', 'by', 'and', 'only', 'just',
    // Hindi-ish shorthand
    'ka', 'ki', 'ke', 'wala', 'wali', 'wale', 'chahiye', 'chaiye', 'dikhao', 'dikha', 'do', 'mujhe', 'ek', 'se', 'packet',
]);
const CHEAP_WORDS = /\b(cheap|cheapest|sasta|saste|sasti|budget|lowest\s+price|low\s+price)\b/i;

/** Word-boundary match for a phrase inside normalised text. */
const phraseRx = (phrase) => new RegExp(`(^|\\s)${escapeRegex(norm(phrase))}(?=\\s|$)`, 'i');

/**
 * Pure: query text + vocabulary -> { q, filters, chips, sort }.
 *
 * filters: { minPrice, maxPrice, brand: [], attr: { Name: [values] }, categoryId, packSize }
 * chips:   [{ id, type, label }] one per recognised filter, for removable UI chips.
 * `exclude` is a list of chip ids to leave out (a chip the shopper removed).
 */
export function parseSearchQuery(raw, vocab = { attributes: [], brands: [], categories: [] }, { exclude = [] } = {}) {
    const skip = new Set((Array.isArray(exclude) ? exclude : String(exclude || '').split(',')).map((s) => String(s).trim()).filter(Boolean));
    let text = ` ${String(raw || '').slice(0, 200)} `;
    const filters = {};
    const chips = [];
    const add = (id, type, label, apply) => {
        if (skip.has(id)) return;
        apply();
        chips.push({ id, type, label });
    };

    // 1. Prices, on the raw text (they need ₹ and commas).
    for (const { rx, kind, needsCurrencyOrBig } of PRICE_PATTERNS) {
        const m = text.match(rx);
        if (!m) continue;
        if (kind === 'range') {
            let a = toAmount(m[1], m[2]);
            let b = toAmount(m[3], m[4]);
            if (a === null || b === null) continue;
            // "2-3 kg" is not a price: bare ranges only with currency or real-looking prices.
            if (needsCurrencyOrBig && !/₹|rs|inr|rupee/i.test(m[0]) && Math.max(a, b) < 50) continue;
            // "2-3 kg" is a pack size, not a price.
            const after = text.slice(text.indexOf(m[0]) + m[0].length);
            if (new RegExp(`^\\s*(${UNIT_WORDS})(?![a-z])`, 'i').test(after)) continue;
            if (a > b) [a, b] = [b, a];
            if (filters.minPrice === undefined && filters.maxPrice === undefined) {
                add('price', 'price', `₹${a} – ₹${b}`, () => { filters.minPrice = a; filters.maxPrice = b; });
            }
        } else if (kind === 'max' && filters.maxPrice === undefined) {
            const v = toAmount(m[1], m[2]);
            if (v === null) continue;
            add('maxPrice', 'price', `Under ₹${v}`, () => { filters.maxPrice = v; });
        } else if (kind === 'min' && filters.minPrice === undefined) {
            const v = toAmount(m[1], m[2]);
            if (v === null) continue;
            add('minPrice', 'price', `Above ₹${v}`, () => { filters.minPrice = v; });
        } else continue;
        text = text.replace(m[0], ' ');
    }

    // 2. Pack size: "5kg", "1 litre", "500 gm".
    const pack = text.match(PACK_RX);
    if (pack) {
        const parsed = parsePackSize(pack[1], pack[2]);
        if (parsed) {
            add('packSize', 'packSize', parsed.label, () => { filters.packSize = parsed.label; });
            text = text.replace(pack[0], ' ');
        }
    }

    let words = norm(text);

    // 3. Attribute values. One- and two-letter values (S, M, XL) only after "size".
    for (const attr of vocab.attributes || []) {
        const values = [...attr.values].sort((a, b) => b.length - a.length);
        for (const value of values) {
            const v = norm(value);
            if (!v) continue;
            const short = v.length <= 2 && !/\d/.test(v);
            const rx = short
                ? new RegExp(`(^|\\s)(?:size|sz)\\s+${escapeRegex(v)}(?=\\s|$)`, 'i')
                : phraseRx(v);
            if (!rx.test(words)) continue;
            const id = `attr:${attr.name}:${value}`;
            add(id, attr.type === 'color' ? 'colour' : 'attribute', attr.type === 'color' ? value : `${attr.name}: ${value}`, () => {
                filters.attr = filters.attr || {};
                (filters.attr[attr.name] = filters.attr[attr.name] || []).push(value);
            });
            words = words.replace(rx, ' ').replace(/\s+/g, ' ').trim();
        }
    }

    // 4. Brands: whole phrase, longest first.
    const brands = [...(vocab.brands || [])].filter((b) => norm(b).length >= 2).sort((a, b) => b.length - a.length);
    for (const brand of brands) {
        const rx = phraseRx(brand);
        if (!rx.test(words)) continue;
        add(`brand:${brand}`, 'brand', brand, () => { (filters.brand = filters.brand || []).push(brand); });
        words = words.replace(rx, ' ').replace(/\s+/g, ' ').trim();
    }

    // 5. Category: a one-to-three word run equal to a category name ("tshirts" = "T-Shirts").
    const byKey = new Map();
    for (const c of vocab.categories || []) {
        const k = looseKey(c.name);
        if (k.length >= 3 && !byKey.has(k)) byKey.set(k, c);
    }
    if (byKey.size) {
        const tokens = words.split(' ').filter(Boolean);
        outer: for (let n = Math.min(3, tokens.length); n >= 1; n -= 1) {
            for (let i = 0; i + n <= tokens.length; i += 1) {
                const cat = byKey.get(looseKey(tokens.slice(i, i + n).join(' ')));
                if (!cat) continue;
                add(`category:${cat.id}`, 'category', cat.name, () => { filters.categoryId = cat.id; });
                tokens.splice(i, n);
                words = tokens.join(' ');
                break outer;
            }
        }
    }

    // 6. "cheap"/"sasta" sorts by price rather than filtering.
    let sort = null;
    if (CHEAP_WORDS.test(words)) {
        if (!skip.has('sort')) {
            sort = 'price_asc';
            chips.push({ id: 'sort', type: 'sort', label: 'Lowest price first' });
        }
        words = words.replace(new RegExp(CHEAP_WORDS.source, 'gi'), ' ');
    }

    const q = norm(words).split(' ').filter((w) => w && !FILLER.has(w)).join(' ');
    return { q, filters, chips, sort, parsed: chips.length > 0 };
}

/* ------------------------------------------------------------ LLM fallback */

const llmCache = new Map();
const LLM_CACHE_MAX = 500;
const LLM_CACHE_TTL_MS = 60 * 60 * 1000;
const LLM_TIMEOUT_MS = 2500;

const LLM_SCHEMA = {
    type: 'OBJECT',
    properties: {
        query: { type: 'STRING' },
        minPrice: { type: 'NUMBER', nullable: true },
        maxPrice: { type: 'NUMBER', nullable: true },
        brand: { type: 'STRING', nullable: true },
        category: { type: 'STRING', nullable: true },
        colour: { type: 'STRING', nullable: true },
        size: { type: 'STRING', nullable: true },
        packSize: { type: 'STRING', nullable: true },
    },
    required: ['query'],
};

/**
 * Validates the model's JSON against the vocabulary and turns it into the
 * same shape the rules produce. Anything not in the DB is dropped.
 */
export function llmResultToFilters(json, vocab, exclude = []) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const pieces = [];
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7 ? v : null);
    const min = num(json.minPrice);
    const max = num(json.maxPrice);
    if (min !== null && max !== null) pieces.push(`between ${Math.min(min, max)} and ${Math.max(min, max)}`);
    else if (max !== null) pieces.push(`under ${max}`);
    else if (min !== null) pieces.push(`above ${min}`);
    const inVocab = (value, list) => list.find((x) => norm(x) === norm(value));
    if (typeof json.brand === 'string' && inVocab(json.brand, vocab.brands || [])) pieces.push(json.brand);
    const cat = typeof json.category === 'string' && (vocab.categories || []).find((c) => looseKey(c.name) === looseKey(json.category));
    if (cat) pieces.push(cat.name);
    const allValues = (vocab.attributes || []).flatMap((a) => a.values);
    if (typeof json.colour === 'string' && inVocab(json.colour, allValues)) pieces.push(json.colour);
    if (typeof json.size === 'string' && inVocab(json.size, allValues)) pieces.push(`size ${json.size}`);
    if (typeof json.packSize === 'string' && PACK_RX.test(json.packSize)) pieces.push(json.packSize.match(PACK_RX)[0]);
    const query = typeof json.query === 'string' ? json.query.slice(0, 100) : '';
    // Re-run the rules over the model's normalised pieces: one code path decides what a filter is.
    const result = parseSearchQuery(`${pieces.join(' ')} ${query}`, vocab, { exclude });
    return result.parsed ? result : null;
}

async function llmParse(raw, vocab, exclude) {
    const key = norm(raw);
    const hit = llmCache.get(key);
    if (hit && Date.now() - hit.at < LLM_CACHE_TTL_MS) return hit.value ? llmResultToFilters(hit.value, vocab, exclude) : null;

    const settings = await getAiSettings();
    let value = null;
    try {
        const result = await callGemini({
            model: effectiveModel(settings),
            systemText: 'You convert an Indian e-commerce search query into filters. Reply with JSON only. '
                + 'Prices are in rupees. Use null for anything the query does not say. "query" is the product words left over, in English.',
            contents: [{ role: 'user', parts: [{ text: String(raw).slice(0, 200) }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: LLM_SCHEMA, maxOutputTokens: 200, temperature: 0 },
            timeoutMs: LLM_TIMEOUT_MS,
        });
        await recordUsage({ userKey: 'system:search', llmCalls: 1, ...result.usage }).catch(() => {});
        value = JSON.parse(result.text);
    } catch (err) {
        logger.warn(`Smart search LLM fallback skipped: ${err.message}`);
        return null; // not cached: a timeout should not stick for an hour
    }
    if (llmCache.size >= LLM_CACHE_MAX) llmCache.delete(llmCache.keys().next().value);
    llmCache.set(key, { at: Date.now(), value });
    return llmResultToFilters(value, vocab, exclude);
}

/**
 * The full smart parse: rules, then (only when they find nothing and it is
 * enabled, keyed and within budget) the model. Returns the parse plus `source`.
 */
export async function smartParse(raw, { exclude = [] } = {}) {
    const vocab = await loadVocabulary();
    const rules = parseSearchQuery(raw, vocab, { exclude });
    if (rules.parsed || !String(raw || '').trim()) return { ...rules, source: 'rules' };
    // Removing every chip is not a request to ask the model again.
    if ((Array.isArray(exclude) ? exclude : String(exclude || '').split(',')).filter(Boolean).length) return { ...rules, source: 'rules' };
    const settings = await getAiSettings();
    if (!settings.enabled || !settings.searchLlmFallback || !hasGeminiKey()) return { ...rules, source: 'rules' };
    if (!(await underMonthlyBudget(settings))) return { ...rules, source: 'rules' };
    const llm = await llmParse(raw, vocab, exclude);
    return llm ? { ...llm, source: 'llm' } : { ...rules, source: 'rules' };
}
