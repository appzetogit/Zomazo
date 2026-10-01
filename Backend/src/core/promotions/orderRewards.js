import { awardPlatformCashback } from './cashback.service.js';
import { earnOrderPoints, reverseOrderPoints } from '../loyalty/loyalty.service.js';
import { CustomerWallet } from '../wallet/customerWallet.model.js';
import { walletOwner } from '../wallet/linkedWallet.js';
import { debitWalletOnce } from '../wallet/walletCredit.js';
import { logger } from '../../utils/logger.js';

/**
 * What every service calls when a customer's order (or ride, or booking)
 * completes: loyalty points, then platform cashback. Both are once per order
 * and neither throws, so a hook can call this on every retry of a delivery.
 *
 * @param {{service: string, customerId: any, orderId: any, orderDisplayId?: string, amount: number}} p
 * @returns {Promise<{points: number, cashback: {awarded: boolean, amount?: number, reason?: string}}>}
 *   cashback.reason 'no_offer': no platform offer applies, so the service may
 *   pay its own older cashback settings instead.
 */
export async function rewardCompletedOrder(p) {
    const args = { ...p, orderId: String(p.orderId), orderDisplayId: p.orderDisplayId ? String(p.orderDisplayId) : '' };
    const points = await earnOrderPoints(args);
    const cashback = await awardPlatformCashback(args);
    return { points, cashback };
}

/**
 * Take back an order's cashback in proportion to a refund, once per `key`,
 * never more than was paid and never below a zero balance. For services with
 * no reverseOrderCashback of their own (Food, Rides, and any admin refund
 * path): rows are written as the Shop's and Quick's are (source
 * 'cashback_reversal'), so each counts the others' take-backs.
 * @returns {Promise<number>} rupees taken back by this call
 */
export async function reverseOrderCashbackShare({ customerId, orderId, refundedAmount, orderTotal, key }) {
    try {
        const oid = String(orderId);
        const owner = await walletOwner(customerId);
        const wallet = await CustomerWallet.findOne({ userId: owner }).select('transactions').lean();
        const txs = wallet?.transactions || [];
        const award = txs.find((t) => t?.metadata?.source === 'cashback' && String(t?.metadata?.orderId || '') === oid);
        if (!award) return 0;
        const already = txs
            .filter((t) => t?.metadata?.source === 'cashback_reversal' && String(t?.metadata?.orderId || '') === oid)
            .reduce((n, t) => n + (Number(t.amount) || 0), 0);
        const total = Number(orderTotal) || 0;
        const share = total > 0 ? Math.min(1, Math.max(0, Number(refundedAmount) / total)) : 1;
        const wanted = Math.min(round2(Number(award.amount) * share), round2(Number(award.amount) - already));
        const k = String(key || 'full');
        return debitWalletOnce(customerId, {
            amount: wanted,
            description: `Cashback returned for refunded order ${award.metadata?.orderDisplayId || oid}`,
            referenceKey: `cashback_reversal:${oid}:${k}`,
            metadata: { source: 'cashback_reversal', orderId: oid, key: k },
        });
    } catch (err) {
        logger.warn(`Cashback not taken back for order ${orderId}: ${err?.message || err}`);
        return 0;
    }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A refund's share of the order: the loyalty points it earned go back pro rata. */
export const reverseOrderRewards = ({ service, orderId, refundedAmount, orderTotal, key }) => {
    const total = Number(orderTotal) || 0;
    const share = total > 0 ? Math.min(1, Math.max(0, Number(refundedAmount) / total)) : 1;
    return reverseOrderPoints({ service, orderId: String(orderId), share, key: String(key || 'full') });
};
