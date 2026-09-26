import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const supportTicketSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'EcomUser', required: true, index: true },
        type: { type: String, enum: ['order', 'seller', 'other'], required: true },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'EcomOrder', default: null },
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'EcomSeller', default: null },
        issueType: { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        status: { type: String, enum: ['open', 'in-progress', 'resolved'], default: 'open', index: true },
        adminResponse: { type: String, default: '' }
    },
    { collection: 'support_tickets', timestamps: true }
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });

export const SupportTicket = ecomModel('SupportTicket', supportTicketSchema);
