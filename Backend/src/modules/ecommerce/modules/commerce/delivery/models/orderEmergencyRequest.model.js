import mongoose from 'mongoose';

const orderEmergencyRequestSchema = new mongoose.Schema(
    {
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
            required: true,
            index: true
        },
        deliveryPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DeliveryPartner',
            required: true,
            index: true
        },
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Seller',
            required: true,
            index: true
        },
        reason: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'processing', 'resolved', 'closed'],
            default: 'open',
            index: true
        },
        adminResponse: { type: String, default: '', trim: true },
        failureReason: { type: String, default: '', trim: true },
        activeKey: { type: String, unique: true, sparse: true },
        deassignedAt: { type: Date, default: null },
        resolvedAt: { type: Date, default: null },
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            default: null
        }
    },
    {
        collection: 'delivery_order_emergency_requests',
        timestamps: true
    }
);

orderEmergencyRequestSchema.index({ deliveryPartnerId: 1, createdAt: -1 });
orderEmergencyRequestSchema.index({ status: 1, createdAt: -1 });

export const DeliveryOrderEmergencyRequest = mongoose.model(
    'DeliveryOrderEmergencyRequest',
    orderEmergencyRequestSchema
);
