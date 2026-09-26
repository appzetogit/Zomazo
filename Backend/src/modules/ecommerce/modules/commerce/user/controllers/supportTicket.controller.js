import mongoose from 'mongoose';
import { SupportTicket } from '../models/supportTicket.model.js';
import { sendResponse, sendError } from '../../../../utils/response.js';

export async function createSupportTicketController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const body = req.body || {};
        const type = String(body.type || '').trim();
        const issueType = String(body.issueType || '').trim();
        const description = String(body.description || '').trim();
        if (!['order', 'seller', 'other'].includes(type)) {
            return sendError(res, 400, 'Invalid ticket type');
        }
        if (!issueType) return sendError(res, 400, 'issueType required');
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendError(res, 401, 'Unauthorized or invalid user');
        }
        const doc = {
            userId: new mongoose.Types.ObjectId(userId),
            type,
            issueType,
            description
        };
        if (type === 'order') {
            if (!body.orderId || !mongoose.Types.ObjectId.isValid(body.orderId)) {
                return sendError(res, 400, 'orderId required');
            }
            const orderMongoId = new mongoose.Types.ObjectId(body.orderId);
            doc.orderId = orderMongoId;
            // Also try to link sellerId automatically if possible
            const { Order } = await import('../../orders/models/order.model.js');
            const order = await Order.findById(orderMongoId).select('sellerId').lean();
            if (order?.sellerId) {
                doc.sellerId = order.sellerId;
            }
        }
        if (type === 'seller') {
            if (!body.sellerId || !mongoose.Types.ObjectId.isValid(body.sellerId)) {
                return sendError(res, 400, 'sellerId required');
            }
            doc.sellerId = new mongoose.Types.ObjectId(body.sellerId);
        }
        const created = await SupportTicket.create(doc);
        return sendResponse(res, 201, 'Ticket created', { ticket: created.toObject() });
    } catch (e) {
        next(e);
    }
}

export async function listMySupportTicketsController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 20, 1), 50);
        const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
        const skip = (page - 1) * limit;
        const [tickets, total] = await Promise.all([
            SupportTicket.find({ userId: new mongoose.Types.ObjectId(userId) })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SupportTicket.countDocuments({ userId: new mongoose.Types.ObjectId(userId) })
        ]);
        return sendResponse(res, 200, 'Tickets fetched', { tickets, total, page, limit });
    } catch (e) {
        next(e);
    }
}
