import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const topBannerSchema = new mongoose.Schema({
    image: {
        type: String,
        required: true,
    },
    publicId: {
        type: String,
    },
    order: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    }
}, {
    timestamps: true
});

const TopBanner = ecomModel('TopBanner', topBannerSchema);

export default TopBanner;
