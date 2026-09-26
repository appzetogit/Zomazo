import mongoose from 'mongoose';

const unregisteredSellerSchema = new mongoose.Schema(
    {
        ownerName: { type: String, required: true, trim: true },
        sellerName: { type: String, required: true, trim: true },
        mobileNumber: { type: String, required: true, trim: true },
        emailId: { type: String, required: true, trim: true },
        location: { type: String, required: true, trim: true }
    },
    { collection: 'unregistered_sellers', timestamps: true }
);

unregisteredSellerSchema.index({ createdAt: -1 });

export const UnregisteredSeller = mongoose.model(
    'UnregisteredSeller',
    unregisteredSellerSchema
);
