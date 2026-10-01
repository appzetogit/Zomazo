import mongoose from 'mongoose';

const userAddressSchema = new mongoose.Schema(
    {
        label: {
            type: String,
            enum: ['Home', 'Office', 'Other'],
            default: 'Home',
            index: true
        },
        street: {
            type: String,
            required: true,
            trim: true
        },
        additionalDetails: {
            type: String,
            default: '',
            trim: true
        },
        city: {
            type: String,
            required: true,
            trim: true
        },
        state: {
            type: String,
            required: true,
            trim: true
        },
        zipCode: {
            type: String,
            default: '',
            trim: true
        },
        phone: {
            type: String,
            default: '',
            trim: true
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                // [lng, lat]
                type: [Number],
                default: undefined,
                validate: {
                    validator: (v) =>
                        v === undefined ||
                        (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))),
                    message: 'location.coordinates must be [lng, lat]'
                }
            }
        },
        isDefault: {
            type: Boolean,
            default: false,
            index: true
        }
    },
    { _id: true, timestamps: true }
);

const userSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true,
            trim: true
        },
        countryCode: {
            type: String,
            default: '+91'
        },
        name: {
            type: String
        },
        email: {
            type: String
        },
        profileImage: {
            type: String,
            default: ''
        },
        fcmTokens: {
            type: [String],
            default: []
        },
        fcmTokenMobile: {
            type: [String],
            default: []
        },
        dateOfBirth: {
            type: Date,
            default: null
        },
        anniversary: {
            type: Date,
            default: null
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other', 'prefer-not-to-say', ''],
            default: ''
        },
        referralCode: {
            type: String
        },
        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            default: null,
            index: true
        },
        referralCount: {
            type: Number,
            default: 0,
            min: 0
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        role: {
            type: String,
            default: 'USER'
        },
        addresses: {
            type: [userAddressSchema],
            default: []
        },
        isBlockedFromCOD: {
            type: Boolean,
            default: false
        },

        /*
         * Quick commerce keeps its customers here since the qc_users merge
         * (core/identity/quickCustomer.js, scripts/migrations/mergeQcUsers.mjs).
         * What only Quick reads is kept under its own names, so Quick's admin,
         * referral programme and single-device sign-in do not touch Food's.
         */
        /** First use of Quick; Quick's admin lists only these customers. */
        quickJoinedAt: { type: Date, default: null, index: true },
        /** Quick's admin turned the customer off in Quick (isActive is every app). */
        quickBlocked: { type: Boolean, default: false },
        /** Quick's referral programme: who invited them there, and how many they invited. */
        quickReferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', default: null, index: true },
        quickReferralCount: { type: Number, default: 0, min: 0 },
        /** Running average of ratings left by Quick's delivery partners. */
        rating: { type: Number, default: 0, min: 0, max: 5 },
        totalRatings: { type: Number, default: 0, min: 0 },
        /** Bumped by Quick's own OTP sign-in; its tokens carry it (single device). */
        tokenVersion: { type: Number, default: 0 },
        /** The qc_users rows merged into this account (makes the merge idempotent). */
        mergedQcIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined }
    },
    {
        collection: 'users',
        timestamps: true
    }
);

userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ 'addresses.location': '2dsphere' });

export const FoodUser = mongoose.model('FoodUser', userSchema);

