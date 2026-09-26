import { Product } from '../../admin/models/product.model.js';
import { syncProductAvailability } from '../../orders/services/inventory.service.js';

/**
 * Re-enable products whose scheduled out-of-stock window has expired.
 * Manual off (no stockResumeAt) is left unchanged until the seller turns it back on.
 *
 * Only the switch is cleared; whether the item then shows in each channel is
 * worked out from that channel's stock, so a timer never undoes a count.
 */
export async function restoreExpiredProductAvailability(filter = {}) {
    const now = new Date();
    const due = await Product.find({
        ...filter,
        stockResumeAt: { $ne: null, $lte: now },
    })
        .select('_id')
        .lean();

    let restored = 0;
    for (const { _id } of due) {
        const res = await Product.updateOne(
            { _id, stockResumeAt: { $ne: null, $lte: now } },
            { $unset: { stockResumeAt: 1, stockOffMode: 1 } },
        );
        if (!res.modifiedCount) continue;
        await syncProductAvailability(_id);
        const fresh = await Product.findById(_id).select('isAvailable').lean();
        if (fresh?.isAvailable) restored += 1;
    }
    return restored;
}
