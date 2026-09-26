import mongoose from 'mongoose';
import { FirstOrderClaim } from '../models/firstOrderClaim.model.js';
import { Checkout } from '../models/checkout.model.js';
import { Order } from '../models/order.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { CANCELLED_ORDER_STATUSES } from './order.helpers.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Admin "Release claim" on a first-order claim: gives the first-order offer
 * back to that person. Only allowed when the order behind the claim did not
 * go ahead (it was cancelled, or it does not exist), so an admin cannot hand
 * out a second first-order discount to someone whose first order is live.
 *
 * POST /admin/first-order-guard/claims/:id/release
 */
async function linkedOrderState(claim) {
    if (claim.checkoutId) {
        const checkout = await Checkout.findById(claim.checkoutId).select('status').lean();
        if (!checkout) return { live: false, why: 'checkout not found' };
        if (checkout.status === 'cancelled') return { live: false, why: 'checkout cancelled' };
        const orders = await Order.find({ checkoutId: claim.checkoutId }).select('orderId orderStatus').lean();
        if (!orders.length) return { live: false, why: 'no orders' };
        const live = orders.filter((o) => !CANCELLED_ORDER_STATUSES.includes(o.orderStatus));
        return live.length
            ? { live: true, orderIds: live.map((o) => o.orderId || String(o._id)) }
            : { live: false, why: 'orders cancelled' };
    }
    if (claim.orderId) {
        const order = await Order.findById(claim.orderId).select('orderId orderStatus').lean();
        if (!order) return { live: false, why: 'order not found' };
        return CANCELLED_ORDER_STATUSES.includes(order.orderStatus)
            ? { live: false, why: 'order cancelled' }
            : { live: true, orderIds: [order.orderId || String(order._id)] };
    }
    return { live: false, why: 'no linked order' };
}

export async function releaseFirstOrderClaimByAdmin(claimId) {
    if (!claimId || !mongoose.Types.ObjectId.isValid(String(claimId))) {
        throw new ValidationError('Invalid claim id');
    }
    const claim = await FirstOrderClaim.findById(claimId).lean();
    if (!claim) throw new NotFoundError('Claim not found');

    const state = await linkedOrderState(claim);
    if (state.live) {
        throw new ValidationError(
            `The order behind this claim is not cancelled (${state.orderIds.join(', ')}). Cancel it first.`,
            { orderIds: state.orderIds },
        );
    }
    await FirstOrderClaim.deleteOne({ _id: claim._id });
    logger.info(`First-order claim ${claim._id} released by admin (${state.why})`);
    return { released: true, id: String(claim._id), reason: state.why };
}
