import { FoodItem } from '../../admin/models/food.model.js';
import { invalidateMenuCaches } from '../../../../middleware/cache.js';

/**
 * Put dishes back on sale when their timed "out of stock" ends.
 *
 * The restaurant panel offers "off for 2 hours / until tomorrow / until a
 * date", and used to keep that timer in the browser: the dish only came back
 * if someone happened to have the Inventory page open when it ran out. The
 * resume time is now stored on the dish (stockResumeAt) and this puts it back.
 *
 * Food's stock switch turns off isActive together with isAvailable (see
 * updateRestaurantFood), so both come back. A dish switched off with no time
 * ("until I turn it on") has no stockResumeAt and is never touched.
 *
 * Idempotent, so every instance may run it: a second run finds nothing due.
 *
 * @returns {Promise<number>} how many dishes came back
 */
export async function restoreExpiredFoodAvailability(filter = {}) {
    const due = { ...filter, isAvailable: false, stockResumeAt: { $ne: null, $lte: new Date() } };
    const restaurants = await FoodItem.distinct('restaurantId', due);
    if (!restaurants.length) return 0;

    const result = await FoodItem.updateMany(due, {
        $set: { isAvailable: true, isActive: true, stockResumeAt: null },
    });
    const restored = result.modifiedCount || 0;
    if (!restored) return 0;

    // A combo is only sold while every dish in it is; bring those back too.
    try {
        const { syncComboAvailability } = await import('../../shared/combo.service.js');
        for (const restaurantId of restaurants) {
            // eslint-disable-next-line no-await-in-loop
            await syncComboAvailability(restaurantId);
        }
    } catch (err) {
        console.error('Combo availability sync after stock resume failed:', err?.message || err);
    }
    await invalidateMenuCaches().catch(() => {});
    return restored;
}
