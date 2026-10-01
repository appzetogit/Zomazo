import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const feedbackExperienceSchema = new mongoose.Schema(
    {
        userId: { 
            type: mongoose.Schema.Types.ObjectId, 
            required: true,
            // userModel keeps the source app's plain names ('User', 'Seller'...) as
            // stored data; the registered models carry the Ecom prefix.
            // Customers are platform accounts since the ecom_users merge.
            ref: function () { return this.userModel === 'User' ? 'FoodUser' : `Ecom${this.userModel}`; }
        },
        userModel: {
            type: String,
            required: true,
            enum: ['User', 'Seller', 'DeliveryPartner'],
            default: 'User'
        },
        sellerId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'EcomSeller', 
            index: true 
        },
        rating: { 
            type: Number, 
            required: true,
            min: 1,
            max: 5
        },
        comment: { 
            type: String, 
            trim: true,
            default: ''
        },
        module: { 
            type: String, 
            enum: ['user', 'seller', 'delivery'],
            required: true,
            index: true
        }
    },
    {
        collection: 'feedback_experiences',
        timestamps: true
    }
);

feedbackExperienceSchema.index({ module: 1, createdAt: -1 });
feedbackExperienceSchema.index({ userId: 1, createdAt: -1 });

export const FeedbackExperience = ecomModel('FeedbackExperience', feedbackExperienceSchema);
