import { ValidationError } from '../../../../core/auth/errors.js';
import { channelForMode } from '../../shared/channels.js';

/**
 * The customer site has two storefronts: the e-commerce shop (courier-shipped,
 * fulfilmentMode "standard") and the quick store (rider, "quick"). Catalogue
 * reads take an optional `fulfilmentMode` so each storefront only lists what it
 * can actually deliver.
 */
export const FULFILMENT_MODES = ['quick', 'standard'];

/** `undefined`/'' -> null (no filter); 'quick' | 'standard'; anything else is a 400. */
export function parseFulfilmentMode(value) {
    if (value === undefined || value === null || value === '') return null;
    const mode = String(value).trim().toLowerCase();
    if (!FULFILMENT_MODES.includes(mode)) {
        throw new ValidationError(`fulfilmentMode must be one of: ${FULFILMENT_MODES.join(', ')}`);
    }
    return mode;
}

/** The channel a storefront reads from: quick -> quick, standard -> shop; null when no mode. */
export const channelForFulfilmentMode = (mode) => (mode ? channelForMode(mode) : null);

/**
 * Product filter for a storefront: listed in the channel and available there
 * (in stock or not counted, and not switched off). The seller half of "can
 * appear in this channel" is fulfilmentModeSellerFilter.
 */
export function fulfilmentModeProductFilter(mode) {
    const channel = channelForFulfilmentMode(mode);
    if (!channel) return null;
    return {
        [`channels.${channel}`]: { $ne: false },
        [`availableIn.${channel}`]: { $ne: false },
    };
}

/** Seller filter for a storefront: account approved and approved for the channel. */
export function fulfilmentModeSellerFilter(mode) {
    const channel = channelForFulfilmentMode(mode);
    if (!channel) return null;
    return { status: 'approved', [`channels.${channel}.status`]: 'approved' };
}
