import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, index: true },
        image: { type: String, trim: true, default: '' },
        type: { type: String, trim: true, default: '' },
        /**
         * Category scope:
         * - When sellerId is missing: category is admin/global and can be shared across sellers.
         * - When sellerId is set: category is private to that seller only.
         *
         * Approval remains available for admin moderation, but approval does not make a
         * seller-owned category globally reusable.
         *
         * Note: existing categories (created by admin historically) should be treated as approved.
         */
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', index: true, default: undefined },
        createdBySellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', index: true, default: undefined },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
        isApproved: { type: Boolean, default: true, index: true },
        rejectionReason: { type: String, trim: true, default: '' },
        requestedAt: { type: Date },
        approvedAt: { type: Date },
        rejectedAt: { type: Date },
        globalizedAt: { type: Date },
        /**
         * Optional zone binding.
         * - When set: category is visible only for that zone.
         * - When null/undefined: category is global (visible for all zones).
         */
        zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', index: true, default: undefined },
        /**
         * Parent category, giving groceries the second level a menu never
         * needed: "Dairy" holds "Milk", "Curd", "Paneer".
         *
         * One optional pointer rather than a separate subcategory collection —
         * a subcategory is a category in every other respect, and splitting
         * them would fork the approval, zone and scope rules that already work.
         * Unset means top level, which is every existing category.
         * ponytail: two levels is all this supports; deeper nesting needs a
         * real tree, and grocery apps do not use one.
         */
        parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true, default: undefined },
        /**
         * The attributes products here vary by (Size, Color...). Children
         * without their own set use their parent's.
         */
        attributeSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttributeSet', default: null },
        /** Sellers need a valid FSSAI licence to list products here (food, groceries). */
        requiresFssai: { type: Boolean, default: false },
        /**
         * Platform commission on items in this category, as a percentage of
         * the line value. Used when the seller has no commission rule of its
         * own; null falls back to the parent category, then to none.
         */
        commissionPercent: { type: Number, min: 0, max: 100, default: null },
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0, index: true }
    },
    {
        collection: 'categories',
        timestamps: true
    }
);

categorySchema.index({ isApproved: 1, createdAt: -1 });
categorySchema.index({ sellerId: 1, isApproved: 1, createdAt: -1 });
categorySchema.index({ approvalStatus: 1, createdAt: -1 });
categorySchema.index({ createdBySellerId: 1, createdAt: -1 });

export const Category = mongoose.model('Category', categorySchema);

