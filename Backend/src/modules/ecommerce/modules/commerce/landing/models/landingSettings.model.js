import mongoose from 'mongoose';

const landingSettingsSchema = new mongoose.Schema(
    {
        exploreMoreHeading: {
            type: String,
            default: 'Explore more'
        },
        recommendedSellerIds: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: 'Seller',
            default: []
        },
        showHeroBanners: {
            type: Boolean,
            default: true
        },
        showExploreIcons: {
            type: Boolean,
            default: true
        },
        showTop10: {
            type: Boolean,
            default: true
        }
    },
    {
        collection: 'landing_settings',
        timestamps: true
    }
);

export const LandingSettings = mongoose.model('LandingSettings', landingSettingsSchema);

