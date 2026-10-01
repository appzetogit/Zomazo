import { WalletBonus, liveWindow, rewardAmount } from './rewards.model.js';
import { creditWalletOnce } from '../wallet/walletCredit.js';
import { logger } from '../../utils/logger.js';

/** The live rule paying the most on a top-up of `amount`, with what it pays. */
export async function bestWalletBonus(amount, now = new Date()) {
    const rules = await WalletBonus.find(liveWindow(now)).lean();
    let best = null;
    for (const rule of rules) {
        const bonus = rewardAmount({ type: rule.bonusType, value: rule.bonusValue, max: rule.maxBonus, min: rule.minTopup }, amount);
        if (bonus > 0 && (!best || bonus > best.bonus)) best = { rule, bonus };
    }
    return best;
}

/**
 * Pay the wallet bonus on a verified top-up, as its own wallet row.
 *
 * Called by every top-up path right after the top-up itself is credited.
 * `reference` is the payment's own id (Razorpay order or payment id), so a
 * retried or double-submitted verify pays the bonus once, as it credits the
 * top-up once. Never throws: the customer's own money is already in; a bonus
 * that failed is logged, not a failed top-up.
 *
 * @returns {Promise<number>} the bonus credited by this call (0 if none)
 */
export async function applyTopupBonus({ customerId, topupAmount, reference, service = '' }) {
    try {
        if (!customerId || !reference) return 0;
        const best = await bestWalletBonus(topupAmount);
        if (!best) return 0;
        const ref = String(reference);
        const credited = await creditWalletOnce(customerId, {
            amount: best.bonus,
            description: `Wallet bonus: ${best.rule.title}`,
            title: 'Wallet bonus',
            referenceKey: `wallet_bonus:${ref}`,
            metadata: { source: 'wallet_bonus', topupRef: ref, topupAmount: Number(topupAmount) || 0, bonusId: String(best.rule._id), service },
        });
        if (!credited) return 0;
        await WalletBonus.updateOne({ _id: best.rule._id }, { $inc: { usedCount: 1, totalCredited: best.bonus } });
        return best.bonus;
    } catch (err) {
        logger.warn(`Wallet bonus not applied for top-up ${reference}: ${err?.message || err}`);
        return 0;
    }
}
