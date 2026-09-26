import mongoose from 'mongoose';

/**
 * One first-order offer, used once per person. A person is recognised by any
 * of: the account, its verified phone, the device, the card/UPI that paid.
 *
 * Each signal has its own unique index, so two checkouts racing from the same
 * device (or account, or phone) cannot both insert a claim: the second insert
 * fails atomically. A signal switched off in the settings is simply not stored.
 *
 * A claim belongs to a checkout (split checkout) or a single order. It is
 * deleted when that order never really happened: cancelled before dispatch, or
 * payment abandoned.
 */
const firstOrderClaimSchema = new mongoose.Schema(
    {
        /** Always set, for reference; not unique (the account signal may be off). */
        ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        /** Set only while the "account" signal is on. */
        userId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
        phoneHash: { type: String, default: undefined },
        deviceIdHash: { type: String, default: undefined },
        paymentHash: { type: String, default: undefined },
        /** The checkout (split checkout) or the order (single order) that used the offer. */
        checkoutId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        orderId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        offerCode: { type: String, default: '' },
        /** A payment fingerprint that matched another claim, seen after the payment was taken. */
        flagged: { type: Boolean, default: false },
        flagReason: { type: String, default: '' },
    },
    { collection: 'first_order_claims', timestamps: true }
);

firstOrderClaimSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
firstOrderClaimSchema.index({ phoneHash: 1 }, { unique: true, partialFilterExpression: { phoneHash: { $type: 'string' } } });
firstOrderClaimSchema.index({ deviceIdHash: 1 }, { unique: true, partialFilterExpression: { deviceIdHash: { $type: 'string' } } });
firstOrderClaimSchema.index({ paymentHash: 1 }, { unique: true, partialFilterExpression: { paymentHash: { $type: 'string' } } });

const firstOrderGuardSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        signals: {
            account: { type: Boolean, default: true },
            phone: { type: Boolean, default: true },
            device: { type: Boolean, default: true },
            payment: { type: Boolean, default: true },
        },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'first_order_guard_settings', timestamps: true }
);

export const FirstOrderClaim = mongoose.model('FirstOrderClaim', firstOrderClaimSchema);
export const FirstOrderGuardSettings = mongoose.model('FirstOrderGuardSettings', firstOrderGuardSettingsSchema);
