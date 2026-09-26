import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    CHANNELS,
    countsOf,
    effectiveStockFor,
    isVariantSellableIn,
    parseChannelCounts,
    parseVariantChannels,
    variantChannelEnabled
} from '../../shared/channels.js';

const toTrimmedString = (value) => (value == null ? '' : String(value).trim());

const toNonNegativeNumber = (value, fallback = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
};

export const extractRawProductVariants = (value = {}) => {
    if (Array.isArray(value?.variants)) return value.variants;
    if (Array.isArray(value?.variations)) return value.variations;
    return [];
};

/** Variant channels / stock / thresholds, each { quick, shop }; keys not sent stay null. */
const variantChannelInput = (entry, name) => {
    const channels = parseVariantChannels(entry?.channels) || {};
    const stock = parseChannelCounts(entry?.stock, `Stock for ${name}`) || {};
    const low = parseChannelCounts(entry?.lowStockThreshold, `Low-stock alert for ${name}`) || {};
    const fill = (obj) => Object.fromEntries(CHANNELS.map((c) => [c, obj[c] ?? null]));
    return { channels: fill(channels), stock: fill(stock), lowStockThreshold: fill(low) };
};

const normalizeAttributes = (value) => {
    if (value == null) return [];
    // Accept { Size: 'M', Color: 'Red' } as well as [{ name, value }].
    const pairs = Array.isArray(value)
        ? value.map((a) => [a?.name, a?.value])
        : typeof value === 'object'
            ? Object.entries(value)
            : null;
    if (!pairs) throw new ValidationError('Variant attributes must be a list of { name, value }');
    const seen = new Set();
    const out = [];
    for (const [rawName, rawValue] of pairs) {
        const name = toTrimmedString(rawName);
        const attrValue = toTrimmedString(rawValue);
        if (!name || !attrValue) throw new ValidationError('Each variant attribute needs a name and a value');
        const key = name.toLowerCase();
        if (seen.has(key)) throw new ValidationError(`Variant has ${name} twice`);
        seen.add(key);
        out.push({ name, value: attrValue });
    }
    return out;
};

/** Most photos one variant may carry (the admin and seller editors stop here too). */
export const MAX_VARIANT_IMAGES = 10;

/**
 * A variant's own photos: URLs as strings, trimmed and de-duplicated the same
 * way product images are. More than the limit is refused rather than cut, so a
 * seller is never told a save worked while photos silently went missing.
 */
const normalizeVariantImages = (value, name) => {
    if (value == null || value === '') return [];
    if (!Array.isArray(value)) throw new ValidationError(`Images for ${name} must be a list of URLs`);
    const images = [];
    for (const raw of value) {
        if (raw != null && typeof raw !== 'string') {
            throw new ValidationError(`Images for ${name} must be a list of URLs`);
        }
        const url = toTrimmedString(raw);
        if (url && !images.includes(url)) images.push(url);
    }
    if (images.length > MAX_VARIANT_IMAGES) {
        throw new ValidationError(`${name} can have at most ${MAX_VARIANT_IMAGES} images`);
    }
    return images;
};

/** The same attributes in any order are the same variant. */
const attributeKey = (attributes = []) =>
    attributes
        .map((a) => `${a.name.toLowerCase()}=${a.value.toLowerCase()}`)
        .sort()
        .join('|');

export const normalizeProductVariantsInput = (value = [], options = {}) => {
    const {
        allowEmpty = true,
        priceLabel = 'Variant price'
    } = options;

    if (value == null || value === '') {
        if (allowEmpty) return [];
        throw new ValidationError('At least one variant is required');
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('Variants must be an array');
    }

    const combos = new Set();
    const normalized = value
        .map((entry = {}) => {
            const attributes = normalizeAttributes(entry?.attributes);
            // A variant built from attributes is named after them ("M / Red")
            // unless the seller gave it a name of their own.
            const name = toTrimmedString(entry?.name) || attributes.map((a) => a.value).join(' / ');
            if (!name) {
                throw new ValidationError('Each variant must have a name or attributes');
            }

            const price = Number(entry?.price);
            if (!Number.isFinite(price) || price <= 0) {
                throw new ValidationError(`${priceLabel} must be greater than 0`);
            }

            const mrpRaw = entry?.mrp;
            let mrp = null;
            if (mrpRaw !== undefined && mrpRaw !== null && mrpRaw !== '') {
                mrp = Number(mrpRaw);
                if (!Number.isFinite(mrp) || mrp <= 0) throw new ValidationError(`MRP for ${name} is invalid`);
                if (price > mrp) throw new ValidationError(`Price of ${name} cannot be above its MRP of ${mrp}`);
            }

            if (attributes.length) {
                const key = attributeKey(attributes);
                if (combos.has(key)) throw new ValidationError(`Two variants have the same options: ${name}`);
                combos.add(key);
            }

            const variant = {
                name,
                price,
                otherPrice: toNonNegativeNumber(entry?.otherPrice, 0),
                attributes,
                sku: toTrimmedString(entry?.sku),
                barcode: toTrimmedString(entry?.barcode),
                mrp,
                ...variantChannelInput(entry, name),
                images: normalizeVariantImages(entry?.images, name),
                isActive: entry?.isActive !== false,
            };

            const variantId = entry?._id || entry?.id;
            if (variantId && mongoose.Types.ObjectId.isValid(String(variantId))) {
                variant._id = new mongoose.Types.ObjectId(String(variantId));
            }

            return variant;
        })
        .filter(Boolean);

    if (!allowEmpty && normalized.length === 0) {
        throw new ValidationError('At least one variant is required');
    }

    return normalized;
};

/**
 * A variant as the apps see it. `inStock` is worked out here so every client
 * agrees: an inactive variant is never in stock, and one without its own count
 * in a channel is in stock there when the product is.
 *
 * `product` gives the product the variants belong to (for inherited switches
 * and shared counts). With `channel`, `inStock` is for that channel and
 * `stockForChannel` is the count that applies; without it, `inStock` means
 * "in stock in at least one channel".
 */
export const serializeProductVariants = (value = [], { product = null, channel = null } = {}) =>
    (Array.isArray(value) ? value : [])
        .map((entry = {}) => {
            const name = toTrimmedString(entry?.name);
            const price = Number(entry?.price);
            if (!name || !Number.isFinite(price) || price <= 0) return null;

            const variantId = entry?._id || entry?.id;
            const isActive = entry?.isActive !== false;
            const owner = product || {};
            const enabledIn = Object.fromEntries(CHANNELS.map((c) => [c, variantChannelEnabled(owner, entry, c)]));
            const availableIn = Object.fromEntries(CHANNELS.map((c) => [c, isVariantSellableIn(owner, entry, c)]));
            const out = {
                id: variantId ? String(variantId) : '',
                _id: variantId ? String(variantId) : '',
                name,
                price,
                otherPrice: toNonNegativeNumber(entry?.otherPrice, 0),
                attributes: Array.isArray(entry?.attributes)
                    ? entry.attributes.map((a) => ({ name: a.name, value: a.value }))
                    : [],
                sku: toTrimmedString(entry?.sku),
                barcode: toTrimmedString(entry?.barcode),
                mrp: entry?.mrp ?? null,
                channels: Object.fromEntries(CHANNELS.map((c) => {
                    const v = entry?.channels?.[c];
                    return [c, v === true || v === false ? v : null];
                })),
                stock: countsOf(entry?.stock),
                lowStockThreshold: countsOf(entry?.lowStockThreshold),
                enabledIn,
                availableIn,
                images: Array.isArray(entry?.images) ? entry.images : [],
                isActive,
                inStock: channel ? availableIn[channel] : CHANNELS.some((c) => availableIn[c]),
            };
            if (channel) out.stockForChannel = effectiveStockFor(owner, entry, channel);
            return out;
        })
        .filter(Boolean);

export const hasProductVariants = (value = {}) => serializeProductVariants(value?.variants || value?.variations || []).length > 0;

export const getProductDisplayPrice = (value = {}) => {
    const variants = serializeProductVariants(value?.variants || value?.variations || []);
    if (variants.length > 0) {
        return Math.min(...variants.map((entry) => Number(entry.price) || 0));
    }

    const price = Number(value?.price);
    return Number.isFinite(price) ? price : 0;
};

export const getProductDisplayOtherPrice = (value = {}) => {
    const variants = serializeProductVariants(value?.variants || value?.variations || []);
    if (variants.length > 0) {
        const validOtherPrices = variants
            .map((entry) => Number(entry.otherPrice) || 0)
            .filter((p) => p > 0);
        return validOtherPrices.length > 0 ? Math.min(...validOtherPrices) : 0;
    }

    const otherPrice = Number(value?.otherPrice);
    if (Number.isFinite(otherPrice) && otherPrice > 0) {
        return otherPrice;
    }

    return 0;
};
