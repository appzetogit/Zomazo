import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
/**
 * "Frequently bought together", precomputed nightly from delivered orders
 * (buildCoPurchaseRecommendations). One document per product and channel.
 */
const productRecommendationSchema = new mongoose.Schema(
    {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'EcomProduct', required: true },
        channel: { type: String, enum: ['quick', 'shop'], required: true },
        type: { type: String, enum: ['frequently_bought'], default: 'frequently_bought' },
        related: {
            type: [{
                _id: false,
                productId: { type: mongoose.Schema.Types.ObjectId, ref: 'EcomProduct' },
                /** Orders (checkouts) containing both products in the window. */
                count: { type: Number, default: 0 },
            }],
            default: [],
        },
        computedAt: { type: Date, default: Date.now },
    },
    { collection: 'product_recommendations', timestamps: true }
);

productRecommendationSchema.index({ productId: 1, channel: 1, type: 1 }, { unique: true });
productRecommendationSchema.index({ computedAt: 1 });

export const ProductRecommendation = ecomModel('ProductRecommendation', productRecommendationSchema);
