import mongoose from 'mongoose';

/**
 * The referral log's schema, built fresh for each store that keeps one. Food
 * and quick commerce log to their own collections, but the rules are one set:
 * quick commerce's copy of this schema lacked refereePhone, so its "one reward
 * per phone" check had nowhere to read from. Sharing the builder keeps a field
 * added here from ever missing there again.
 */
export function buildReferralLogSchema() {
    const referralLogSchema = new mongoose.Schema(
        {
            referrerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
            refereeId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
            role: {
                type: String,
                enum: ['USER', 'DELIVERY_PARTNER'],
                required: true,
                index: true
            },
            rewardAmount: { type: Number, required: true, min: 0, default: 0 },
            /** Last 10 digits of the referee's phone: one reward per phone, ever. */
            refereePhone: { type: String, default: '', index: true },
            status: {
                type: String,
                enum: ['pending', 'credited', 'rejected'],
                default: 'pending',
                index: true
            },
            reason: { type: String, default: '' }
        },
        { collection: 'food_referral_logs', timestamps: true }
    );

    // One referral credit decision per created account per role.
    referralLogSchema.index({ refereeId: 1, role: 1 }, { unique: true });
    referralLogSchema.index({ referrerId: 1, role: 1, createdAt: -1 });
    return referralLogSchema;
}

export const FoodReferralLog = mongoose.model('FoodReferralLog', buildReferralLogSchema());
