import mongoose from 'mongoose';

const orderTransactionSchema = new mongoose.Schema({
    // Identifiers
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner', index: true },

    // Core Payment Info
    paymentMethod: { 
        type: String, 
        enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'], 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'authorized', 'captured', 'failed', 'refunded'], 
        default: 'pending',
        index: true 
    },
    currency: { type: String, default: 'INR' },

    // Snapshot of order pricing at the time transaction was created
    pricing: {
        subtotal: { type: Number, default: 0, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        deliveryFeeGst: { type: Number, default: 0, min: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        sellerCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        couponCode: { type: String, default: null, trim: true, uppercase: true },
        total: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'INR', trim: true },
    },

    // Snapshot of payment state at the time of transaction (source of truth for UI)
    payment: {
        method: { type: String, default: 'cash', trim: true },
        status: { type: String, default: 'cod_pending', trim: true },
        amountDue: { type: Number, default: 0, min: 0 },
        razorpay: {
            orderId: { type: String, default: '' },
            paymentId: { type: String, default: '' },
            signature: { type: String, default: '' }
        },
        qr: {
            qrId: { type: String, default: '' },
            imageUrl: { type: String, default: '' },
            paymentLinkId: { type: String, default: '' },
            shortUrl: { type: String, default: '' },
            status: { type: String, default: '' },
            expiresAt: { type: Date, default: null }
        }
    },

    // Financial Breakdown (The Split)
    amounts: {
        totalCustomerPaid: { type: Number, required: true, min: 0 },
        sellerShare: { type: Number, required: true, min: 0 },
        sellerCommission: { type: Number, required: true, min: 0 },
        riderShare: { type: Number, required: true, min: 0 },
        // Can be negative when discounts/rider pay exceed platform income; store the real value.
        platformNetProfit: { type: Number, required: true },
        taxAmount: { type: Number, default: 0, min: 0 },
        adminDiscountShare: { type: Number, default: 0, min: 0 },
        sellerDiscountShare: { type: Number, default: 0, min: 0 },
        discountAdminBearPercentage: { type: Number, default: 0, min: 0, max: 100 },
        discountSellerBearPercentage: { type: Number, default: 0, min: 0, max: 100 }
    },

    // Gateway / Provider Metadata
    gateway: {
        provider: { type: String, default: 'razorpay' },
        razorpayOrderId: String,
        razorpayPaymentId: String,
        razorpaySignature: String,
        qrUrl: String,
        qrExpiresAt: Date
    },

    // Settlement Tracking
    settlement: {
        isSellerSettled: { type: Boolean, default: false },
        sellerSettledAt: Date,
        isRiderSettled: { type: Boolean, default: false },
        riderSettledAt: Date
    },

    // Audit History (Replacing OrderPayment ledger)
    history: [{
        kind: { type: String, required: true }, // 'created', 'authorized', 'captured', 'refunded', 'settled'
        amount: Number,
        at: { type: Date, default: Date.now },
        note: String,
        recordedBy: { 
            role: { type: String }, 
            id: { type: mongoose.Schema.Types.ObjectId }
        }
    }]
}, { 
    collection: 'order_transactions', 
    timestamps: true 
});

// Powerful indexes for Finance & Analytics
orderTransactionSchema.index({ createdAt: -1 });
orderTransactionSchema.index({ 'settlement.isSellerSettled': 1, sellerId: 1 });
orderTransactionSchema.index({ 'status': 1, paymentMethod: 1 });

export const OrderTransaction = mongoose.model('OrderTransaction', orderTransactionSchema);
