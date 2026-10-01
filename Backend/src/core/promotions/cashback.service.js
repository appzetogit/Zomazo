import { CashbackOffer, CashbackOfferUse, liveWindow, rewardAmount } from './rewards.model.js';
import { creditWalletOnce } from '../wallet/walletCredit.js';
import { walletOwner } from '../wallet/linkedWallet.js';
import { CustomerWallet } from '../wallet/customerWallet.model.js';
import { logger } from '../../utils/logger.js';

/**
 * Platform cashback offers (rewards.model.js), paid on a completed order of any
 * service into the customer's ONE wallet.
 *
 * The wallet row is written the way each service's own cashback always wrote
 * it -- metadata.source 'cashback' with the order's id -- so the Shop's and
 * Quick's "a return takes back the order's cashback" (reverseOrderCashback)
 * and every cashback history screen pick these up with no change.
 */

const SERVICE_NAMES = {
    food: 'Food', quickCommerce: 'Quick', ecommerce: 'Shop', taxi: 'Rides', serviceProvider: 'Services',
};

/** The live offers for a service, best payout for this amount first. */
export async function cashbackOffersFor(service, amount, now = new Date()) {
    const offers = await CashbackOffer.find({ ...liveWindow(now), services: service }).lean();
    return offers
        .map((o) => ({
            offer: o,
            amount: rewardAmount({ type: o.cashbackType, value: o.cashbackValue, max: o.maxCashback, min: o.minOrderValue }, amount),
        }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount);
}

// Claim one award under the offer's per-customer limit. The limit is in the
// filter, and the unique index refuses an upsert past it.
async function claimUse(offer, platformUserId) {
    const limit = Number(offer.perUserLimit) || 0;
    try {
        const r = await CashbackOfferUse.updateOne(
            limit > 0
                ? { offerId: offer._id, platformUserId, count: { $lt: limit } }
                : { offerId: offer._id, platformUserId },
            { $inc: { count: 1 } },
            { upsert: true },
        );
        return r.matchedCount === 1 || r.upsertedCount === 1;
    } catch (err) {
        if (err?.code === 11000) return false;
        throw err;
    }
}

const releaseUse = (offer, platformUserId) =>
    CashbackOfferUse.updateOne({ offerId: offer._id, platformUserId, count: { $gt: 0 } }, { $inc: { count: -1 } });

/**
 * Pay the best platform cashback offer on a completed order. Once per order:
 * a second call, or one after the service's own cashback paid it, is a no-op.
 *
 * Never throws -- a cashback failure must not fail a delivery.
 *
 * @param {object} p
 * @param {string} p.service        one of REWARD_SERVICES
 * @param {string} p.customerId     the service's customer id (translated to the platform account)
 * @param {string} p.orderId        the order's _id
 * @param {string} [p.orderDisplayId]
 * @param {number} p.amount         what the cashback is worked out on (item subtotal, ride fare)
 * @returns {Promise<{awarded: boolean, amount?: number, reason?: string}>}
 *   reason 'no_offer' means no platform offer applies, and the service may fall
 *   back to its own older cashback settings.
 */
export async function awardPlatformCashback({ service, customerId, orderId, orderDisplayId, amount }) {
    try {
        if (!customerId || !orderId) return { awarded: false, reason: 'invalid' };
        const oid = String(orderId);
        const owner = await walletOwner(customerId);
        const paid = await CustomerWallet.exists({
            userId: owner,
            transactions: { $elemMatch: { 'metadata.source': 'cashback', 'metadata.orderId': oid } },
        });
        if (paid) return { awarded: false, reason: 'already_awarded' };

        const candidates = await cashbackOffersFor(service, amount);
        if (!candidates.length) return { awarded: false, reason: 'no_offer' };

        for (const { offer, amount: cashback } of candidates) {
            if (!(await claimUse(offer, owner))) continue; // this offer's limit is used up; try the next
            const display = orderDisplayId || oid;
            const credited = await creditWalletOnce(customerId, {
                amount: cashback,
                description: `Cashback on ${SERVICE_NAMES[service] || ''} order ${display}`.replace(/\s+/g, ' '),
                title: 'Cashback',
                referenceKey: `cashback:${service}:${oid}`,
                metadata: { source: 'cashback', service, orderId: oid, orderDisplayId: display, offerId: String(offer._id), offerTitle: offer.title },
            }, {
                guard: { transactions: { $not: { $elemMatch: { 'metadata.source': 'cashback', 'metadata.orderId': oid } } } },
            });
            if (!credited) {
                await releaseUse(offer, owner);
                return { awarded: false, reason: 'already_awarded' };
            }
            await CashbackOffer.updateOne({ _id: offer._id }, { $inc: { usedCount: 1, totalCredited: cashback } });
            logger.info(`Platform cashback Rs ${cashback} (${offer.title}) for ${service} order ${oid}`);
            return { awarded: true, amount: cashback, offerId: String(offer._id) };
        }
        return { awarded: false, reason: 'per_user_limit_reached' };
    } catch (err) {
        logger.warn(`awardPlatformCashback failed for ${service} order ${orderId}: ${err?.message || err}`);
        return { awarded: false, reason: 'error' };
    }
}
