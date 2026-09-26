import { ValidationError } from '../../../../core/auth/errors.js';

const FULFILMENT_MODES = ['quick', 'standard'];

/**
 * Reads the optional `fulfilmentMode` query the two admin panels send
 * (/admin/quick sends 'quick', /admin/shop sends 'standard').
 * Returns undefined when absent so callers keep their unfiltered behaviour.
 */
export const validateFulfilmentModeQuery = (query = {}) => {
    const raw = query?.fulfilmentMode;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const mode = String(raw).trim().toLowerCase();
    if (!FULFILMENT_MODES.includes(mode)) {
        throw new ValidationError(`fulfilmentMode must be one of: ${FULFILMENT_MODES.join(', ')}`);
    }
    return mode;
};

/**
 * Mongo filter for Order.fulfilmentMode. Orders created before the field
 * existed have no value and default to quick, so 'quick' matches "not standard".
 */
export const orderFulfilmentModeFilter = (mode) => {
    if (mode === 'quick') return { fulfilmentMode: { $ne: 'standard' } };
    if (mode === 'standard') return { fulfilmentMode: 'standard' };
    return {};
};
