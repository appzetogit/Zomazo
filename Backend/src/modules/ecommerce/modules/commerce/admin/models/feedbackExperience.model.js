import mongoose from 'mongoose';

const feedbackExperienceSchema = new mongoose.Schema(
    {
        userId: { 
            type: mongoose.Schema.Types.ObjectId, 
            required: true,
            refPath: 'userModel'
        },
        userModel: {
            type: String,
            required: true,
            enum: ['User', 'Seller', 'DeliveryPartner'],
            default: 'User'
        },
        sellerId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Seller', 
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

export const FeedbackExperience = mongoose.model('FeedbackExperience', feedbackExperienceSchema);
