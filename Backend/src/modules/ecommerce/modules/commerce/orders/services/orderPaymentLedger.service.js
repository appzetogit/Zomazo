import mongoose from 'mongoose';
import { OrderTransaction } from '../models/orderTransaction.model.js';
import { Order } from '../models/order.model.js';
import { ForbiddenError, ValidationError } from '../../../../core/auth/errors.js';

function buildOrderIdentityFilter(orderIdOrMongoId) {
    const raw = String(orderIdOrMongoId || '').trim();
    if (!raw) return null;
    if (mongoose.isValidObjectId(raw)) return { _id: new mongoose.Types.ObjectId(raw) };
    return { orderId: raw };
}

/**
 * List ledger entries for an order (newest first). User must own the order.
 * Reads from the consolidated OrderTransaction history.
 */
export async function listOrderPaymentsForUser(orderIdParam, userId) {
    const identity = buildOrderIdentityFilter(orderIdParam);
    if (!identity) throw new ValidationError('Order id required');

    const order = await Order.findOne(identity).select('_id userId orderId').lean();
    if (!order) throw new ValidationError('Order not found');
    if (order.userId?.toString() !== String(userId)) throw new ForbiddenError('Not your order');

    const transaction = await OrderTransaction.findOne({ orderId: order._id }).lean();
    const rows = transaction?.history || [];

    return { 
        orderId: order.orderId, 
        orderMongoId: order._id.toString(), 
        payments: rows.map(r => ({
            ...r,
            method: transaction.paymentMethod,
            status: transaction.status,
            amount: transaction.amounts?.totalCustomerPaid || 0,
            currency: transaction.currency || 'INR'
        }))
    };
}
