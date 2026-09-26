import mongoose from 'mongoose';

/**
 * "Saved for later": cart lines a customer parked, per storefront (mode
 * 'shop' | 'quick', the same split as user_carts). One row per product+variant.
 */
const savedForLaterSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        mode: { type: String, enum: ['shop', 'quick'], required: true },
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        variantId: { type: String, trim: true, default: '' },
        qty: { type: Number, min: 1, max: 99, default: 1 },
    },
    { collection: 'user_saved_for_later', timestamps: true },
);

savedForLaterSchema.index({ userId: 1, mode: 1, productId: 1, variantId: 1 }, { unique: true });
savedForLaterSchema.index({ userId: 1, mode: 1, updatedAt: -1 });

export const SavedForLater = mongoose.models.SavedForLater || mongoose.model('SavedForLater', savedForLaterSchema);
