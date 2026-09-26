import { isCancelledOrder } from '../orders/services/order.helpers.js';
import { resolveDiscountSplit } from './discountSplit.util.js';

/** Delivered / completed orders that count toward seller earnings. */
export function isSellerEarnedOrder(order) {
    if (isCancelledOrder(order)) return false;
    const orderStatus = String(order?.orderStatus || order?.status || '').trim().toLowerCase();
    const deliveryPhase = String(order?.deliveryState?.currentPhase || '').trim().toLowerCase();
    return (
        orderStatus === 'delivered' ||
        deliveryPhase === 'delivered' ||
        deliveryPhase === 'completed'
    );
}

/**
 * Seller net share for one order — same formula as Hub Finance / wallet payout.
 */
export function computeSellerOrderShare(order, tx = null, offers = [], sellerId = null) {
    const pricing = tx?.pricing || order?.pricing || {};
    const amounts = tx?.amounts || {};
    const subtotal = Number(pricing.subtotal) || 0;
    const packagingFee = Number(pricing.packagingFee) || 0;
    const commission = Number(amounts.sellerCommission) || Number(pricing.sellerCommission) || 0;
    const discountSplit = resolveDiscountSplit({ order, pricing, amounts, offers, sellerId });
    const sellerDiscountShare = discountSplit.sellerDiscountShare;
    const storedSellerShare = Number(amounts.sellerShare);

    const payout = Number.isFinite(storedSellerShare)
        ? storedSellerShare
        : subtotal + packagingFee - commission - sellerDiscountShare;

    return Math.max(0, payout);
}
