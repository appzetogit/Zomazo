import { logger } from '../../utils/logger.js';

/**
 * Ends timed "out of stock" windows on the server, for food and quick commerce.
 *
 * Sellers switch an item off "for 2 hours" or "until tomorrow" in the panel.
 * The panel used to run that timer in the browser, so the item only came back
 * if the Inventory page happened to be open at the time. The resume time is
 * stored on the item (stockResumeAt) and this sweep puts items back when it
 * passes. Each restore is a conditional updateMany, so several instances
 * running it at once is harmless.
 */
const SWEEP_MS = 60 * 1000;

export async function sweepStockResumes() {
    const [{ restoreExpiredFoodAvailability: food }, { restoreExpiredFoodAvailability: quick }] = await Promise.all([
        import('../../modules/food/restaurant/services/foodAvailability.service.js'),
        import('../../modules/quickCommerce/modules/food/restaurant/services/foodAvailability.service.js'),
    ]);
    const [foodCount, quickCount] = await Promise.all([food(), quick()]);
    return { food: foodCount, quick: quickCount };
}

let sweeper = null;
export function startStockResumeSweeper() {
    if (sweeper) return sweeper;
    const tick = () => {
        sweepStockResumes()
            .then(({ food, quick }) => {
                if (food || quick) logger.info(`stockResume: back on sale -- food ${food}, quick ${quick}`);
            })
            .catch((err) => logger.warn(`stockResume: sweep failed: ${err.message}`));
    };
    tick();
    sweeper = setInterval(tick, SWEEP_MS);
    sweeper.unref?.();
    return sweeper;
}

export function stopStockResumeSweeper() {
    if (sweeper) clearInterval(sweeper);
    sweeper = null;
}
