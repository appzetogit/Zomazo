import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const landingSettingsSchema = new mongoose.Schema(
    {
        exploreMoreHeading: {
            type: String,
            default: 'Explore more'
        },
        recommendedSellerIds: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: 'EcomSeller',
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

export const LandingSettings = ecomModel('LandingSettings', landingSettingsSchema);

