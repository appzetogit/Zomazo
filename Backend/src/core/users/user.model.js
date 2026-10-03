import mongoose from 'mongoose';
import { phoneLast10Plugin } from '../../core/identity/phoneLast10.cjs';

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
            type: String,
            trim: true
        },
        email: {
            type: String,
            trim: true,
            lowercase: true
        },
        // Taxi's customer password, for the admin-made accounts that sign in with
        // one. Hidden: nothing outside taxi reads it, and taxi asks with '+password'.
        password: {
            type: String,
            minlength: 5,
            select: false
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
        mergedQcIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },

        /*
         * The Shop's customers, since the ecom_users merge (core/identity/shopCustomer.js),
         * under the Shop's own names for the same reasons as Quick's above.
         * shopTokenVersion is the Shop's single-device counter, apart from
         * Quick's, so signing in to one does not sign the other out.
         */
        shopJoinedAt: { type: Date, default: null, index: true },
        shopBlocked: { type: Boolean, default: false },
        shopReferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', default: null, index: true },
        shopReferralCount: { type: Number, default: 0, min: 0 },
        shopTokenVersion: { type: Number, default: 0 },
        mergedEcomIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },

        /*
         * Services customers, since the sp_users merge (core/identity/spCustomer.js).
         * Identity is this account; what only Services keeps (plans, the unpaid
         * cancellation-fee bucket, settings, booking stats, favourites, an
         * SP-native password) is on its profile row, sp_profiles, under this _id.
         * spBlocked is the Services admin's switch; isActive stays every app's.
         */
        spJoinedAt: { type: Date, default: null, index: true },
        spBlocked: { type: Boolean, default: false },
        spReferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', default: null, index: true },
        spReferralCount: { type: Number, default: 0, min: 0 },
        /** The Services share code (SPxxxxxx) people already hold. */
        spReferralCode: { type: String, trim: true, uppercase: true, default: undefined, index: true },
        mergedSpIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },

        /*
         * Taxi's customers have always been rows of this collection; these are the
         * fields only taxi writes. They used to live in a second schema
         * (modules/taxi/user/models/User.js) over the same documents, which meant a
         * taxi write skipped this schema's hooks -- phoneLast10 among them.
         *
         * `active` is taxi's own switch, like quickBlocked/shopBlocked above;
         * isActive stays every app's. Deleting an account (deletedAt) is not a
         * per-app matter, so whatever sets deletedAt sets isActive false too.
         */
        active: { type: Boolean, default: true },
        deletedAt: { type: Date, default: null },
        deletion_reason: { type: String, default: '', trim: true },
        deletionRequest: {
            status: {
                type: String,
                enum: ['none', 'pending', 'approved', 'rejected'],
                default: 'none',
                index: true
            },
            reason: { type: String, default: '', trim: true },
            requestedAt: { type: Date, default: null },
            reviewedAt: { type: Date, default: null },
            reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiAdmin', default: null },
            adminNote: { type: String, default: '', trim: true }
        },
        currentRideId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', default: null },
        pending_cancellation_due: { type: Number, default: 0 },
        /** Taxi's referral reward: rides the invitee has completed, and when it paid. */
        referredRideCompletionCount: { type: Number, default: 0, min: 0 },
        referralRewardGrantedAt: { type: Date, default: null }
    },
    {
        collection: 'users',
        timestamps: true
    }
);

userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ 'addresses.location': '2dsphere' });
userSchema.index({ 'deletionRequest.status': 1, deletedAt: 1 });

// Indexed last-10-digit phone, so sign-in finds the row without a regex scan
// (core/identity/phoneLast10.cjs).
userSchema.plugin(phoneLast10Plugin, { pairs: [['phone', 'phoneLast10']] });

export const FoodUser = mongoose.model('FoodUser', userSchema);

