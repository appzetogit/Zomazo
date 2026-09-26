import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Sales channels: Quick (rider, minutes) and Shop (courier). See
 * CHANNELS_CONTRACT.md at the repo root.
 *
 * Pure helpers only (no models), so the product model can use them.
 */
export const CHANNELS = ['quick', 'shop'];
export const CHANNEL_STATUSES = ['none', 'pending', 'approved', 'rejected'];

/** An order's fulfilmentMode -> the channel its stock lives in. */
export const channelForMode = (mode) => (mode === 'standard' ? 'shop' : 'quick');
export const modeForChannel = (channel) => (channel === 'shop' ? 'standard' : 'quick');

export function assertChannel(value, label = 'channel') {
    const c = String(value ?? '').trim().toLowerCase();
    if (!CHANNELS.includes(c)) throw new ValidationError(`${label} must be one of: ${CHANNELS.join(', ')}`);
    return c;
}

const isCounted = (n) => n !== null && n !== undefined;

/* ------------------------------------------------------------------ seller */

export const sellerChannelStatus = (seller, channel) => seller?.channels?.[channel]?.status || 'none';

/** Sells in a channel only when the account is approved AND that channel is. */
export const isSellerApprovedFor = (seller, channel) =>
    seller?.status === 'approved' && sellerChannelStatus(seller, channel) === 'approved';

export const approvedChannelsOf = (seller) => CHANNELS.filter((c) => sellerChannelStatus(seller, c) === 'approved');

/** 'quick' | 'shop' | 'quick,shop' | ['quick'] -> ['quick'] (validated, deduped). */
export function parseChannelList(value) {
    let raw = value;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (s.startsWith('[')) {
            try { raw = JSON.parse(s); } catch { raw = s; }
        }
    }
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const picked = [...new Set(list.map((c) => String(c ?? '').trim().toLowerCase()).filter(Boolean))];
    for (const c of picked) {
        if (!CHANNELS.includes(c)) throw new ValidationError(`Unknown channel "${c}". Use quick, shop or quick,shop`);
    }
    return picked;
}

export const emptySellerChannel = () => ({ status: 'none', rejectionReason: null, appliedAt: null, decidedAt: null });

export const serializeSellerChannels = (seller) =>
    Object.fromEntries(CHANNELS.map((c) => {
        const ch = seller?.channels?.[c] || {};
        return [c, {
            status: ch.status || 'none',
            rejectionReason: ch.rejectionReason ?? null,
            appliedAt: ch.appliedAt ?? null,
            decidedAt: ch.decidedAt ?? null,
        }];
    }));

/* ----------------------------------------------------------------- product */

export const productChannelEnabled = (product, channel) => product?.channels?.[channel] !== false;

/** Product must be on for the channel; a variant can only narrow it (null inherits). */
export const variantChannelEnabled = (product, variant, channel) =>
    productChannelEnabled(product, channel) && variant?.channels?.[channel] !== false;

/** null = not counted. */
export const productStockFor = (product, channel) => {
    const n = product?.stock?.[channel];
    return isCounted(n) ? Number(n) : null;
};

export const variantHasOwnStock = (variant, channel) => isCounted(variant?.stock?.[channel]);

/** The count that applies to a line: the variant's own, else the product's. null = not counted. */
export const effectiveStockFor = (product, variant, channel) =>
    variant && variantHasOwnStock(variant, channel) ? Number(variant.stock[channel]) : productStockFor(product, channel);

const inStockCount = (n) => n === null || n > 0;

export function isVariantSellableIn(product, variant, channel) {
    return variant?.isActive !== false
        && variantChannelEnabled(product, variant, channel)
        && inStockCount(effectiveStockFor(product, variant, channel));
}

/** Enabled and something is in stock (or not counted), ignoring the seller's manual switch. */
export function isSellableIn(product, channel) {
    if (!productChannelEnabled(product, channel)) return false;
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length) return variants.some((v) => isVariantSellableIn(product, v, channel));
    return inStockCount(productStockFor(product, channel));
}

/** Manual off is `stockOffMode`; running out never sets it. */
export const isManuallyOff = (product) => product?.stockOffMode !== null && product?.stockOffMode !== undefined;

export function computeAvailableIn(product) {
    const off = isManuallyOff(product);
    return Object.fromEntries(CHANNELS.map((c) => [c, !off && isSellableIn(product, c)]));
}

/**
 * The same computation as a Mongo aggregation expression, for a pipeline
 * update. One pipeline update reads and writes the document atomically, so
 * concurrent orders and restocks cannot act on a stale read.
 */
export function availableInPipeline() {
    const variants = { $ifNull: ['$variants', []] };
    const nul = (path) => ({ $eq: [{ $ifNull: [path, null] }, null] });
    const prodSellable = (c) => ({ $or: [nul(`$stock.${c}`), { $gt: [`$stock.${c}`, 0] }] });
    const sellable = (c) => ({
        $and: [
            { $ne: [`$channels.${c}`, false] },
            {
                $cond: [
                    { $gt: [{ $size: variants }, 0] },
                    {
                        $anyElementTrue: [{
                            $map: {
                                input: variants,
                                as: 'v',
                                in: {
                                    $and: [
                                        { $ne: ['$$v.isActive', false] },
                                        { $ne: [`$$v.channels.${c}`, false] },
                                        { $cond: [nul(`$$v.stock.${c}`), prodSellable(c), { $gt: [`$$v.stock.${c}`, 0] }] },
                                    ],
                                },
                            },
                        }],
                    },
                    prodSellable(c),
                ],
            },
        ],
    });
    const manualOn = nul('$stockOffMode');
    return [
        { $set: Object.fromEntries(CHANNELS.map((c) => [`availableIn.${c}`, { $and: [manualOn, sellable(c)] }])) },
        { $set: { isAvailable: { $or: CHANNELS.map((c) => `$availableIn.${c}`) } } },
    ];
}

/* ------------------------------------------------------------ input parsing */

const parseMaybeJson = (value) => {
    if (typeof value !== 'string') return value;
    const s = value.trim();
    if (!s.startsWith('{')) return value;
    try { return JSON.parse(s); } catch { throw new ValidationError('Invalid channel object'); }
};

const parseBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * Product `channels`: { quick, shop } booleans, or a list ('quick,shop', ['shop']).
 * Returns undefined when not sent. Missing keys in an object are left out
 * (the caller merges with what the product has).
 */
export function parseProductChannels(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') throw new ValidationError('channels must include at least one of quick, shop');
    const v = parseMaybeJson(value);
    if (Array.isArray(v) || typeof v === 'string') {
        const picked = parseChannelList(v);
        return Object.fromEntries(CHANNELS.map((c) => [c, picked.includes(c)]));
    }
    if (typeof v !== 'object') throw new ValidationError('channels must be an object like { quick: true, shop: false }');
    const out = {};
    for (const c of CHANNELS) if (v[c] !== undefined && v[c] !== null) out[c] = parseBool(v[c]);
    return out;
}

/** Variant `channels`: each true/false/null (null inherits). Undefined when not sent. */
export function parseVariantChannels(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const v = parseMaybeJson(value);
    if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('Variant channels must be { quick, shop }');
    const out = {};
    for (const c of CHANNELS) {
        if (v[c] === undefined) continue;
        out[c] = v[c] === null || v[c] === '' ? null : parseBool(v[c]);
    }
    return out;
}

const toCount = (value, label) => {
    if (value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        throw new ValidationError(`${label} must be a whole number of 0 or more`);
    }
    return n;
};

/**
 * `stock` / `lowStockThreshold`: { quick, shop } of number|null. Undefined when
 * not sent; keys not sent are left out (leave alone), null means "not counted".
 */
export function parseChannelCounts(value, label = 'Stock') {
    if (value === undefined) return undefined;
    if (value === null || value === '') return Object.fromEntries(CHANNELS.map((c) => [c, null]));
    const v = parseMaybeJson(value);
    if (typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(`${label} must be an object like { quick: 10, shop: null }`);
    const out = {};
    for (const c of CHANNELS) if (v[c] !== undefined) out[c] = toCount(v[c], `${label} for ${c}`);
    return out;
}

/** Throws a 400 when a product (or variant) enables a channel the seller is not approved for. */
export function assertChannelsAllowedForSeller(seller, channels = {}, what = 'This product') {
    const approved = approvedChannelsOf(seller);
    for (const c of CHANNELS) {
        if (channels?.[c] === true && !approved.includes(c)) {
            throw new ValidationError(
                `${what} cannot be listed in ${c === 'quick' ? 'Quick' : 'Shop'}: your store is not approved for that channel`,
            );
        }
    }
    if (channels && CHANNELS.every((c) => channels[c] === false)) {
        throw new ValidationError(`${what} must be listed in at least one channel`);
    }
}

/**
 * Product `channels`, `stock` and `lowStockThreshold` from a request, merged
 * over `existing` (null on create). Channels are checked against the seller's
 * approvals: a product can only be listed where its seller may sell.
 */
export function buildProductChannelFields(seller, body = {}, existing = null, variants = []) {
    const out = {};
    const sentChannels = parseProductChannels(body.channels);
    if (sentChannels !== undefined || !existing) {
        const base = existing?.channels || (sentChannels ? { quick: true, shop: true } : defaultChannelsFor(seller));
        const channels = Object.fromEntries(CHANNELS.map((c) => [c, sentChannels?.[c] ?? base?.[c] !== false]));
        assertChannelsAllowedForSeller(seller, channels);
        out.channels = channels;
    }
    for (const v of variants || []) {
        const on = Object.fromEntries(CHANNELS.map((c) => [c, v?.channels?.[c] === true]));
        if (CHANNELS.some((c) => on[c])) assertChannelsAllowedForSeller(seller, on, `Variant ${v.name}`);
    }
    for (const field of ['stock', 'lowStockThreshold']) {
        const sent = parseChannelCounts(body[field], field === 'stock' ? 'Stock' : 'Low-stock alert');
        if (sent === undefined) continue;
        const base = existing?.[field] || {};
        out[field] = Object.fromEntries(CHANNELS.map((c) => [c, c in sent ? sent[c] : (base[c] ?? null)]));
    }
    return out;
}

/** A product created without `channels` is listed wherever its seller is approved. */
export function defaultChannelsFor(seller) {
    const approved = CHANNELS.filter((c) => seller?.channels?.[c]?.status === 'approved');
    if (!approved.length) {
        throw new ValidationError('This store is not approved for Quick or Shop yet, so it cannot list products');
    }
    return Object.fromEntries(CHANNELS.map((c) => [c, approved.includes(c)]));
}

/* ---------------------------------------------------------- serialization */

export const channelsOf = (product) => Object.fromEntries(CHANNELS.map((c) => [c, productChannelEnabled(product, c)]));
export const countsOf = (obj) => Object.fromEntries(CHANNELS.map((c) => [c, isCounted(obj?.[c]) ? Number(obj[c]) : null]));

/**
 * Channel fields every product response carries. `channel` adds
 * stockForChannel. With `seller` (storefront reads), `availableIn` also needs
 * the seller to be approved for the channel, so it answers "can a customer buy
 * this there".
 */
export function productChannelFields(product, channel = null, seller = undefined) {
    const availableIn = computeAvailableIn(product);
    if (seller !== undefined) {
        for (const c of CHANNELS) availableIn[c] = availableIn[c] && isSellerApprovedFor(seller, c);
    }
    const fields = {
        channels: channelsOf(product),
        stock: countsOf(product?.stock),
        lowStockThreshold: countsOf(product?.lowStockThreshold),
        availableIn,
    };
    if (channel) fields.stockForChannel = productStockFor(product, channel);
    return fields;
}
