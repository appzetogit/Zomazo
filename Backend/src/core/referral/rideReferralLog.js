/**
 * Rides' referral log: one row per referred customer, as the other services
 * keep (food_referral_logs and the rest), so Master > Referral activity and a
 * customer's list of invites can show Rides too.
 *
 * Rides pays by one of four kinds (Taxi admin > Referral): at sign-up
 * (instant_*), or once the new customer has completed N rides
 * (conditional_*). A conditional invite is logged `pending` at sign-up and
 * settled when the rides are done. Rider referrals are not logged here.
 */
import mongoose from 'mongoose';

const schema = new mongoose.Schema(
    {
        referrerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        refereeId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
        refereePhone: { type: String, default: '' },
        role: { type: String, default: 'USER' },
        kind: { type: String, enum: ['signup', 'after_rides'], default: 'signup' },
        rewardAmount: { type: Number, default: 0 },
        status: { type: String, enum: ['pending', 'credited', 'rejected'], default: 'pending', index: true },
        reason: { type: String, default: '' },
    },
    { collection: 'taxi_referral_logs', timestamps: true },
);

export const RideReferralLog = mongoose.models.RideReferralLog || mongoose.model('RideReferralLog', schema);

/**
 * Record where a customer's Rides referral stands. One row per referee: a
 * later call (the rides done, a retry) updates it. A settled row -- credited,
 * or rejected -- is never turned back to pending.
 * Never throws: the log must not stop a reward or a ride.
 */
export async function recordRideReferral({ referrerId, refereeId, refereePhone, kind, rewardAmount = 0, status, reason = '' }) {
    if (!referrerId || !refereeId) return;
    try {
        const phone = String(refereePhone || '').replace(/\D/g, '').slice(-10);
        const set = { referrerId, refereePhone: phone, kind, rewardAmount: Number(rewardAmount) || 0, status, reason };
        const filter = status === 'pending' ? { refereeId, status: { $nin: ['credited', 'rejected'] } } : { refereeId };
        await RideReferralLog.updateOne(filter, { $set: set, $setOnInsert: { role: 'USER' } }, { upsert: true });
    } catch (err) {
        if (err?.code !== 11000) console.warn('[rides referral] log not written:', err.message);
    }
}
