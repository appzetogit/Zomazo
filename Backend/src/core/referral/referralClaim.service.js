/**
 * One customer referral reward per person, across the whole platform.
 *
 * Each service ran its own referral programme with its own "one reward per
 * phone" rule, so one person joining Food, then Quick, then the Shop could earn
 * their referrer three rewards -- and Rides' after-N-rides reward paid again for
 * someone Food had already rewarded, because both read `referredBy` on the one
 * account. The platform's rule (decided 30 Sep 2026) is one reward per person.
 *
 * Before a service pays a CUSTOMER referral reward it claims the referee's phone
 * here (claimReferralForPhone). The first programme to claim a phone wins; any
 * later one is told who holds it and pays nothing. A programme that claims and
 * then cannot pay after all (its referrer is at their cap) gives the claim back.
 *
 * History counts: a phone already credited in any service's referral log
 * (before this register existed) is treated as claimed by that service. Rides
 * keeps no log, so its past rewards count from here on.
 *
 * Rider and driver referrals are a different programme and are not covered.
 */
import mongoose from 'mongoose';

const claimSchema = new mongoose.Schema(
    {
        phone: { type: String, required: true, unique: true },
        programme: { type: String, required: true },
        referrerId: { type: mongoose.Schema.Types.ObjectId, default: null },
        refereeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'platform_referral_claims', timestamps: true },
);

export const PlatformReferralClaim = mongoose.models.PlatformReferralClaim
    || mongoose.model('PlatformReferralClaim', claimSchema);

export const REFERRAL_PROGRAMMES = Object.freeze(['food', 'quickCommerce', 'ecommerce', 'taxi', 'serviceProvider']);

/** Each programme's own log of credited customer referrals, for history. */
const PROGRAMME_LOGS = [
    { programme: 'food', collection: 'food_referral_logs', customerOnly: { role: 'USER' } },
    { programme: 'quickCommerce', collection: 'qc_referral_logs', customerOnly: { role: 'USER' } },
    { programme: 'ecommerce', collection: 'ecom_referral_logs', customerOnly: { role: 'USER' } },
    { programme: 'serviceProvider', collection: 'sp_referral_logs', customerOnly: {} },
];

export const referralPhone = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/** The programme a phone was already rewarded in before this register, or null. */
async function rewardedInHistory(phone, exceptProgramme) {
    for (const log of PROGRAMME_LOGS) {
        if (log.programme === exceptProgramme) continue;
        const hit = await mongoose.connection.db
            .collection(log.collection)
            .findOne({ refereePhone: phone, status: 'credited', ...log.customerOnly }, { projection: { _id: 1 } });
        if (hit) return log.programme;
    }
    return null;
}

/**
 * Claim `phone` for `programme`'s referral reward. Returns { claimed: true }
 * for the first programme (and again for the same programme, so a retry is
 * harmless), else { claimed: false, heldBy }. A phone that cannot be read is
 * not enforced here (each programme's own rules still apply).
 */
export async function claimReferralForPhone({ phone, programme, referrerId = null, refereeId = null }) {
    const key = referralPhone(phone);
    if (key.length !== 10) return { claimed: true, unenforced: true };

    const existing = await PlatformReferralClaim.findOne({ phone: key }).lean();
    if (existing) {
        return existing.programme === programme ? { claimed: true } : { claimed: false, heldBy: existing.programme };
    }
    const earlier = await rewardedInHistory(key, programme);
    if (earlier) {
        // Record it, so the next check is one lookup; a race to record is harmless.
        await PlatformReferralClaim.create({ phone: key, programme: earlier }).catch(() => {});
        return { claimed: false, heldBy: earlier };
    }
    try {
        await PlatformReferralClaim.create({ phone: key, programme, referrerId, refereeId });
        return { claimed: true };
    } catch (err) {
        if (err?.code !== 11000) throw err;
        const winner = await PlatformReferralClaim.findOne({ phone: key }).lean();
        return winner?.programme === programme ? { claimed: true } : { claimed: false, heldBy: winner?.programme || null };
    }
}

/** Give a claim back: the programme claimed but did not pay after all. */
export async function releaseReferralClaim({ phone, programme }) {
    const key = referralPhone(phone);
    if (key.length !== 10) return;
    await PlatformReferralClaim.deleteOne({ phone: key, programme }).catch(() => {});
}
