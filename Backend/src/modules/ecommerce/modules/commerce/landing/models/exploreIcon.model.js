import mongoose from 'mongoose';

const exploreIconSchema = new mongoose.Schema(
    {
        label: {
            type: String,
            required: true
        },
        iconUrl: {
            type: String,
            required: true
        },
        publicId: {
            type: String,
            required: true
        },
        linkType: {
            type: String,
            enum: ['offers', 'top-10', 'collections', 'custom'],
            default: 'custom'
        },
        targetPath: {
            type: String
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
        collection: 'explore_icons',
        timestamps: true
    }
);

exploreIconSchema.index({ isActive: 1, sortOrder: 1 });

export const ExploreIcon = mongoose.model('ExploreIcon', exploreIconSchema);

