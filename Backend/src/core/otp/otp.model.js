import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true
        },
        scope: {
            type: String,
            required: true,
            index: true
        },
        // Plain-text code, only on rows written before codes were hashed.
        otp: {
            type: String
        },
        // HMAC of the code (see otp.service.js); the code itself is not stored.
        otpHash: {
            type: String
        },
        salt: {
            type: String
        },
        expiresAt: {
            type: Date,
            required: true
        },
        attempts: {
            type: Number,
            default: 0
        },
        requestCount: {
            type: Number,
            default: 1
        },
        lastRequestAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        collection: 'food_otps',
        timestamps: true
    }
);

// TTL index for automatic expiry
otpSchema.index({ phone: 1, scope: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FoodOtp = mongoose.model('FoodOtp', otpSchema);

