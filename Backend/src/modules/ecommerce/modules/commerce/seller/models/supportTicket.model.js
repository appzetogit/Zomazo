import mongoose from 'mongoose';

const sellerSupportTicketSchema = new mongoose.Schema(
    {
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Seller',
            required: true,
            index: true
        },
        category: {
            type: String,
            enum: ['orders', 'payments', 'menu', 'seller', 'technical', 'other'],
            required: true
        },
        issueType: { type: String, required: true, trim: true },
        subject: { type: String, default: '', trim: true },
        description: { type: String, default: '', trim: true },
        orderRef: { type: String, default: '', trim: true },
        priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium', index: true },
        status: { type: String, enum: ['open', 'in-progress', 'resolved'], default: 'open', index: true },
        adminResponse: { type: String, default: '' }
    },
    { collection: 'seller_support_tickets', timestamps: true }
);

sellerSupportTicketSchema.index({ sellerId: 1, createdAt: -1 });
sellerSupportTicketSchema.index({ status: 1, createdAt: -1 });

export const SellerSupportTicket = mongoose.model(
    'SellerSupportTicket',
    sellerSupportTicketSchema
);
