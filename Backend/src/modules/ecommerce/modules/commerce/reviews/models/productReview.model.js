import mongoose from 'mongoose';

/**
 * A customer's review of a product they received. One per customer per
 * product (editable). Published on write; moderation can hide or remove it.
 *
 * status:
 *   visible - shown, counted in the product's rating
 *   hidden  - taken down by an admin (can be restored), not counted
 *   removed - deleted by an admin with a reason; kept for the record, never shown
 */
const reportSchema = new mongoose.Schema(
    {
        byRole: { type: String, enum: ['USER', 'SELLER', 'ADMIN'], required: true },
        byId: { type: mongoose.Schema.Types.ObjectId, required: true },
        reason: { type: String, trim: true, default: '' },
        at: { type: Date, default: Date.now },
    },
    { _id: false },
);

const moderationEntrySchema = new mongoose.Schema(
    {
        action: { type: String, enum: ['hide', 'unhide', 'remove'], required: true },
        reason: { type: String, trim: true, default: '' },
        byId: { type: mongoose.Schema.Types.ObjectId, default: null },
        at: { type: Date, default: Date.now },
    },
    { _id: false },
);

const productReviewSchema = new mongoose.Schema(
    {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        /** The delivered order that made the customer eligible. */
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
        /** Channel that order was fulfilled in ('quick' | 'shop'); the admin panels filter on it. */
        channel: { type: String, enum: ['quick', 'shop'], default: 'quick', index: true },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        rating: { type: Number, required: true, min: 1, max: 5 },
        title: { type: String, trim: true, default: '', maxlength: 120 },
        text: { type: String, trim: true, default: '', maxlength: 2000 },
        images: { type: [String], default: [] },
        status: { type: String, enum: ['visible', 'hidden', 'removed'], default: 'visible' },
        moderationReason: { type: String, trim: true, default: '' },
        moderation: { type: [moderationEntrySchema], default: [] },
        reports: { type: [reportSchema], default: [] },
        reportCount: { type: Number, default: 0, min: 0 },
        /** Who marked it helpful; never sent to clients. */
        helpfulVoters: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },
        helpfulCount: { type: Number, default: 0, min: 0 },
        /** The seller's single public reply. */
        reply: {
            type: new mongoose.Schema(
                { text: { type: String, trim: true, maxlength: 1000 }, at: { type: Date, default: Date.now } },
                { _id: false },
            ),
            default: null,
        },
        editedAt: { type: Date, default: null },
    },
    { collection: 'product_reviews', timestamps: true },
);

productReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
productReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
productReviewSchema.index({ productId: 1, status: 1, helpfulCount: -1, createdAt: -1 });
productReviewSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
productReviewSchema.index({ status: 1, reportCount: -1, createdAt: -1 });

export const ProductReview = mongoose.models.ProductReview || mongoose.model('ProductReview', productReviewSchema);
