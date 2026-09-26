import { BusinessSettings } from '../../admin/models/businessSettings.model.js';
import { getShippingProvider } from '../../delivery/services/shipping/index.js';
import { getSellerTimezone } from '../../../../utils/timezone.js';
import { logger } from '../../../../utils/logger.js';

/**
 * When a Shop (courier) order would arrive: "Delivery by Thu, 24 Sep".
 *
 * The admin's standard window (Business Settings, default 2-4 days) is the
 * answer unless a real courier is configured and knows the pincode, in which
 * case its estimate wins. The mock provider (dev/tests without credentials)
 * always says 3 days, which is not information, so it is ignored.
 *
 * Calendar days in the store's timezone, counted from today; no Sunday or
 * holiday skipping.
 */

const DEFAULT_DAYS = { min: 2, max: 4 };
const COURIER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const courierCache = new Map(); // pincode -> { at, days: number | null, serviceable }

export const clearDeliveryEstimateCache = () => courierCache.clear();

const settingDays = async () => {
    const settings = await BusinessSettings.findOne().select('standardDeliveryDays').lean();
    const min = Number(settings?.standardDeliveryDays?.min);
    const max = Number(settings?.standardDeliveryDays?.max);
    if (Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min) return { min, max };
    return { ...DEFAULT_DAYS };
};

const courierEstimate = async (pincode) => {
    const provider = getShippingProvider();
    if (!provider || provider.name === 'mock' || !pincode) return null;
    const hit = courierCache.get(pincode);
    if (hit && Date.now() - hit.at < COURIER_CACHE_TTL_MS) return hit;
    try {
        const result = await provider.checkServiceability(pincode);
        const days = Math.round(Number(result?.estimatedDays));
        const entry = {
            at: Date.now(),
            serviceable: result?.serviceable !== false,
            days: Number.isFinite(days) && days > 0 && days < 60 ? days : null,
        };
        courierCache.set(pincode, entry);
        return entry;
    } catch (error) {
        // A courier outage must not take the product page down with it; the
        // admin's standard window is still a fair promise. Not cached, so the
        // next request tries again.
        logger?.warn?.(`delivery estimate: courier lookup failed for ${pincode}: ${error.message}`);
        return null;
    }
};

/** YYYY-MM-DD of today + n days in the store's timezone. */
export const localDatePlusDays = (days, now = new Date(), timeZone = getSellerTimezone()) => {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(now)
        .split('-')
        .map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export async function getDeliveryEstimate({ pincode = '', now = new Date() } = {}) {
    const fallback = await settingDays();
    const courier = await courierEstimate(pincode);
    let minDays = fallback.min;
    let maxDays = fallback.max;
    let source = 'default';
    if (courier?.days) {
        minDays = courier.days;
        maxDays = courier.days;
        source = 'courier';
    }
    return {
        pincode: pincode || null,
        serviceable: courier ? courier.serviceable : true,
        minDays,
        maxDays,
        fromDate: localDatePlusDays(minDays, now),
        toDate: localDatePlusDays(maxDays, now),
        source,
    };
}
