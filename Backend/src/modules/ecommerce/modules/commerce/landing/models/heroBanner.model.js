import mongoose from 'mongoose';

const heroBannerSchema = new mongoose.Schema(
    {
        imageUrl: {
            type: String,
            required: true
        },
        publicId: {
            type: String,
            required: true
        },
        title: {
            type: String
        },
        ctaText: {
            type: String
        },
        ctaLink: {
            type: String
        },
        linkedSellerIds: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: 'Seller',
            default: []
        },
        sortOrder: {
            type: Number,
            default: 0,
            index: true
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        collection: 'hero_banners',
        timestamps: true
    }
);

heroBannerSchema.index({ isActive: 1, sortOrder: 1 });

export const HeroBanner = mongoose.model('HeroBanner', heroBannerSchema);

