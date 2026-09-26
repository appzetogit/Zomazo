import mongoose from 'mongoose';

const userCartItemSchema = new mongoose.Schema(
    {
        lineItemId: { type: String, trim: true, default: '' },
        itemId: { type: String, trim: true, default: '' },
        name: { type: String, trim: true, default: '' },
        price: { type: Number, min: 0, default: 0 },
        quantity: { type: Number, min: 1, default: 1 },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        variantPrice: { type: Number, min: 0, default: 0 },
        /** Compare-at / other-platform unit price for strikethrough UI. */
        otherPrice: { type: Number, min: 0, default: 0 },
        image: { type: String, default: '' },
        foodType: { type: String, default: '' },
        isVeg: { type: Boolean, default: null },
        /** The line's store; a shop cart can span several stores. */
        sellerId: { type: String, trim: true, default: '' },
        sellerName: { type: String, trim: true, default: '' },
    },
    { _id: false },
);

const userCartSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        /** Which storefront this cart belongs to. Legacy docs without it are 'shop'. */
        mode: { type: String, enum: ['shop', 'quick'], default: 'shop' },
        sellerId: { type: String, trim: true, default: '' },
        sellerName: { type: String, trim: true, default: '' },
        items: {
            type: [userCartItemSchema],
            default: [],
        },
        itemCount: { type: Number, min: 0, default: 0 },
        subtotal: { type: Number, min: 0, default: 0 },
        pricing: {
            type: {
                subtotal: { type: Number, min: 0, default: 0 },
                tax: { type: Number, min: 0, default: 0 },
                packagingFee: { type: Number, min: 0, default: 0 },
                deliveryFee: { type: Number, min: 0, default: 0 },
                platformFee: { type: Number, min: 0, default: 0 },
                quickDeliveryFee: { type: Number, min: 0, default: 0 },
                deliveryMode: { type: String, enum: ['basic', 'quick'], default: 'basic' },
                discount: { type: Number, min: 0, default: 0 },
                total: { type: Number, min: 0, default: 0 },
                savings: { type: Number, min: 0, default: 0 },
                couponCode: { type: String, default: '' },
                deliveryFeeBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
                appliedCoupon: { type: mongoose.Schema.Types.Mixed, default: null },
            },
            default: null,
        },
    },
    {
        collection: 'user_carts',
        timestamps: true,
    },
);

// One cart per user per storefront. partialFilterExpression-free so legacy docs
// (no mode) still collide with nothing: they are migrated to mode 'shop' on write.
userCartSchema.index({ userId: 1, mode: 1 }, { unique: true, name: 'userId_1_mode_1' });
userCartSchema.index({ updatedAt: -1 });
userCartSchema.index({ sellerId: 1 });

export const UserCart = mongoose.model('UserCart', userCartSchema);
