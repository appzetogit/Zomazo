import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema(
    {
        couponCode: { type: String, required: true, trim: true, uppercase: true, unique: true },
        discountType: { type: String, enum: ['percentage', 'flat-price'], default: 'percentage', index: true },
        discountValue: { type: Number, required: true, min: 0 },
        customerScope: { type: String, enum: ['all', 'first-time'], default: 'all', index: true },
        sellerScope: { type: String, enum: ['all', 'selected'], default: 'all', index: true },
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
        sellerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Seller' }],
        minOrderValue: { type: Number, default: 0, min: 0 },
        maxDiscount: { type: Number, default: null, min: 0 },
        usageLimit: { type: Number, default: null, min: 0 },
        perUserLimit: { type: Number, default: null, min: 0 },
        usedCount: { type: Number, default: 0, min: 0 },
        startDate: { type: Date },
        isFirstOrderOnly: { type: Boolean, default: false },
        endDate: { type: Date },
        status: { type: String, enum: ['active', 'paused', 'inactive'], default: 'active', index: true },
        showInCart: { type: Boolean, default: true },
        createdByRole: { type: String, enum: ['ADMIN', 'SELLER'], default: 'ADMIN', index: true },
        adminBearPercentage: { type: Number, default: 100, min: 0, max: 100 },
        sellerBearPercentage: { type: Number, default: 0, min: 0, max: 100 }
    },
    { collection: 'offers', timestamps: true }
);

offerSchema.index({ sellerId: 1, createdAt: -1 });
offerSchema.index({ sellerIds: 1, createdAt: -1 });

export const Offer = mongoose.model('Offer', offerSchema);
