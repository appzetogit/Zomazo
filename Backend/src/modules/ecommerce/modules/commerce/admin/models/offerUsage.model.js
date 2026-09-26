import mongoose from 'mongoose';

const offerUsageSchema = new mongoose.Schema(
    {
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', index: true, required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
        count: { type: Number, default: 0, min: 0 },
        lastUsedAt: { type: Date, default: null }
    },
    { collection: 'offer_usages', timestamps: true }
);

offerUsageSchema.index({ offerId: 1, userId: 1 }, { unique: true });

export const OfferUsage = mongoose.models.OfferUsage || mongoose.model('OfferUsage', offerUsageSchema);
