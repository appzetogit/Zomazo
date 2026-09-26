import mongoose from 'mongoose';

const checkoutPricingSchema = new mongoose.Schema(
    {
        subtotal: { type: Number, required: true, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        coinsUsed: { type: Number, default: 0, min: 0 },
        coinsDiscount: { type: Number, default: 0, min: 0 },
        couponCode: { type: String, default: null },
        grandTotal: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR' },
    },
    { _id: false },
);

const checkoutPaymentSchema = new mongoose.Schema(
    {
        method: {
            type: String,
            enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'],
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'paid', 'failed', 'cod_pending', 'refunded'],
            default: 'pending',
        },
        gatewayOrderId: { type: String, default: '' },
        gatewayPaymentId: { type: String, default: '' },
        paidAt: { type: Date, default: null },
    },
    { _id: false },
);

const checkoutSchema = new mongoose.Schema(
    {
        checkoutId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        fulfilmentMode: {
            type: String,
            enum: ['quick', 'standard'],
            default: 'quick',
            index: true,
        },
        childOrderIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
        }],
        childOrderCodes: [{
            type: String,
        }],
        sellerIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Seller',
        }],
        customerAddress: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        pricing: {
            type: checkoutPricingSchema,
            required: true,
        },
        payment: {
            type: checkoutPaymentSchema,
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'processing', 'completed', 'cancelled', 'partial_cancelled'],
            default: 'pending',
            index: true,
        },
        appliedCoupon: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
    },
    {
        collection: 'checkouts',
        timestamps: true,
    },
);

checkoutSchema.index({ createdAt: -1 });

export const Checkout = mongoose.model('Checkout', checkoutSchema);
