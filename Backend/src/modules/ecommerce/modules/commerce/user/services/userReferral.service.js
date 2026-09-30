import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { User } from '../../../../core/users/user.model.js';
import { UserWallet } from '../models/userWallet.model.js';
import { ReferralSettings } from '../../admin/models/referralSettings.model.js';
import { ReferralLog } from '../../admin/models/referralLog.model.js';
import { buildReferralLinkFromTemplate } from '../../delivery/services/deliveryReferral.service.js';
import { creditReferralReward } from './userWallet.service.js';
import { referralSettingsFor } from '../../../../../../core/referral/referralSettings.service.js';
import { inviteCodeForRow, resolveInviter } from '../../../../../../core/referral/inviteCode.service.js';
import { ensureShopCustomer } from '../../../../core/auth/auth.middleware.js';
import { claimReferralForPhone, releaseReferralClaim } from '../../../../../../core/referral/referralClaim.service.js';

// What the Shop pays: its own settings, with Master > Referral's values in place.
const shopReferralSettings = () => referralSettingsFor('ecommerce', ReferralSettings);

export const getUserReferralStats = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc] = await Promise.all([
        User.findById(oid).select('_id referralCount referralCode').lean(),
        UserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        shopReferralSettings()
    ]);
    // The person's one invite code (core/referral/inviteCode.service.js), else this row's own.
    const shareCode = String((await inviteCodeForRow('ecom_users', id).catch(() => null)) || user?.referralCode || user?._id || '');

    return {
        referralCode: shareCode,
        referralLink: buildReferralLinkFromTemplate(settingsDoc?.referralLinkUser, shareCode, ''),
        referralCount: Number(user?.referralCount) || 0,
        totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
        rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0),
        referralLimit: Math.max(0, Number(settingsDoc?.referralLimitUser) || 0)
    };
};

export const getUserReferralDetails = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }

    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc, logs] = await Promise.all([
        User.findById(oid).select('_id referralCount referralCode').lean(),
        UserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        shopReferralSettings(),
        ReferralLog.find({ referrerId: oid, role: 'USER' })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean()
    ]);
    const shareCode = String((await inviteCodeForRow('ecom_users', id).catch(() => null)) || user?.referralCode || user?._id || '');

    const refereeIds = Array.from(
        new Set(
            (Array.isArray(logs) ? logs : [])
                .map((log) => String(log?.refereeId || ''))
                .filter(Boolean)
        )
    )
        .filter((value) => mongoose.Types.ObjectId.isValid(value))
        .map((value) => new mongoose.Types.ObjectId(value));

    const referees = refereeIds.length
        ? await User.find({ _id: { $in: refereeIds } })
            .select('_id name phone profileImage')
            .lean()
        : [];

    const refereeMap = new Map(referees.map((entry) => [String(entry._id), entry]));

    const invitedFriends = (Array.isArray(logs) ? logs : []).map((log) => {
        const referee = refereeMap.get(String(log?.refereeId || ''));
        const rawPhone = String(referee?.phone || '');
        const maskedPhone = rawPhone
            ? `${rawPhone.slice(0, Math.min(3, rawPhone.length))}${'*'.repeat(Math.max(rawPhone.length - 5, 0))}${rawPhone.slice(-2)}`
            : '';

        return {
            id: String(log?._id || ''),
            refereeId: String(log?.refereeId || ''),
            name: String(referee?.name || '').trim() || 'Friend',
            phone: maskedPhone,
            profileImage: String(referee?.profileImage || '').trim() || '',
            status: String(log?.status || 'pending'),
            reason: String(log?.reason || ''),
            rewardAmount: Math.max(0, Number(log?.rewardAmount) || 0),
            earnedAmount: String(log?.status || '') === 'credited' ? Math.max(0, Number(log?.rewardAmount) || 0) : 0,
            invitedAt: log?.createdAt || null
        };
    });

    const totalInvited = invitedFriends.length;
    const creditedCount = invitedFriends.filter((entry) => entry.status === 'credited').length;
    const pendingCount = invitedFriends.filter((entry) => entry.status === 'pending').length;
    const rejectedCount = invitedFriends.filter((entry) => entry.status === 'rejected').length;

    return {
        stats: {
            referralCode: shareCode,
            referralLink: buildReferralLinkFromTemplate(settingsDoc?.referralLinkUser, shareCode, ''),
            referralCount: Number(user?.referralCount) || 0,
            totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
            rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0),
            referralLimit: Math.max(0, Number(settingsDoc?.referralLimitUser) || 0),
            totalInvited,
            creditedCount,
            pendingCount,
            rejectedCount
        },
        invitedFriends
    };
};

/**
 * Credit a Shop invite when a friend signs up through the platform sign-in
 * (/login?ref=...&via=shop, core/referral/signupReferral.service.js).
 *
 * `ref` is what the Shop's invite link carries: the referrer's Shop customer
 * id, or their platform id, or the referral code on their Shop row. The
 * referee is their Shop customer row. Pays what the Shop's settings (or
 * Master) say, at most `referralLimitUser` times per referrer -- the cap is
 * claimed atomically, so parallel sign-ups cannot run past it -- and once per
 * referee: ReferralLog is unique on { refereeId, role }.
 *
 * @returns {Promise<{ credited: boolean, reason?: string }>}
 */
export const creditShopSignupReferral = async ({ refereeId, ref } = {}) => {
    const code = String(ref || '').trim();
    if (!code || !mongoose.Types.ObjectId.isValid(String(refereeId || ''))) return { credited: false, reason: 'no_referral' };
    const referee = await User.findById(refereeId).select('_id referredBy platformUserId phone').lean();
    if (!referee) return { credited: false, reason: 'no_referee' };
    if (referee.referredBy) return { credited: false, reason: 'already_referred' };
    // One reward per phone number, ever, as on the platform sign-in: deleting
    // the Shop account and signing up again makes a new row (a new refereeId),
    // which the unique index alone would pay again.
    const refereePhone = String(referee.phone || '').replace(/\D/g, '').slice(-10);

    const or = [{ referralCode: code }];
    if (mongoose.Types.ObjectId.isValid(code)) {
        const oid = new mongoose.Types.ObjectId(code);
        or.push({ _id: oid }, { platformUserId: oid });
    }
    let referrer = await User.findOne({ $or: or }).select('_id platformUserId').lean();
    if (!referrer) {
        // Any code the platform knows the friend by (one code per person,
        // core/referral/inviteCode.service.js); they get a Shop row if they have none.
        const platformId = await resolveInviter(code);
        const rowId = platformId ? await ensureShopCustomer(String(platformId)) : null;
        referrer = rowId ? await User.findById(rowId).select('_id platformUserId').lean() : null;
    }
    if (!referrer) return { credited: false, reason: 'unknown_referrer' };
    const self = String(referrer._id) === String(referee._id)
        || (referrer.platformUserId && String(referrer.platformUserId) === String(referee.platformUserId));
    if (self) return { credited: false, reason: 'self_referral' };

    const settings = await shopReferralSettings();
    const reward = Math.max(0, Number(settings?.referralRewardUser) || 0);
    const limit = Math.max(0, Number(settings?.referralLimitUser) || 0);

    // The one decision for this referee. A second sign-up for the same Shop
    // row stops here (duplicate key), before anything is paid.
    let log;
    try {
        log = await ReferralLog.create({
            referrerId: referrer._id,
            refereeId: referee._id,
            role: 'USER',
            rewardAmount: reward,
            status: 'pending',
            refereePhone
        });
    } catch (err) {
        if (err?.code === 11000) return { credited: false, reason: 'already_referred' };
        throw err;
    }

    const phoneAlreadyRewarded = refereePhone
        ? await ReferralLog.exists({ refereePhone, role: 'USER', status: 'credited', _id: { $ne: log._id } })
        : false;
    if (phoneAlreadyRewarded) {
        await ReferralLog.updateOne({ _id: log._id }, { $set: { status: 'rejected', reason: 'phone_already_rewarded' } });
        return { credited: false, reason: 'phone_already_rewarded' };
    }

    // One reward per person across every service (core/referral/referralClaim.service.js).
    const platformClaim = reward > 0 && limit > 0
        ? await claimReferralForPhone({ phone: refereePhone, programme: 'ecommerce', referrerId: referrer._id, refereeId: referee._id })
        : null;
    if (platformClaim && !platformClaim.claimed) {
        await ReferralLog.updateOne({ _id: log._id }, { $set: { status: 'rejected', reason: 'rewarded_in_other_service' } });
        return { credited: false, reason: 'rewarded_in_other_service' };
    }

    const claimed = reward > 0 && limit > 0
        ? await User.updateOne(
            { _id: referrer._id, $or: [{ referralCount: { $lt: limit } }, { referralCount: { $exists: false } }] },
            { $inc: { referralCount: 1 } }
        )
        : null;
    if (claimed?.modifiedCount !== 1) {
        if (platformClaim?.claimed) await releaseReferralClaim({ phone: refereePhone, programme: 'ecommerce' });
        const reason = reward <= 0 ? 'reward_disabled' : limit <= 0 ? 'limit_disabled' : 'limit_reached';
        await ReferralLog.updateOne({ _id: log._id }, { $set: { status: 'rejected', reason } });
        return { credited: false, reason };
    }

    await User.updateOne({ _id: referee._id }, { $set: { referredBy: referrer._id } });
    await creditReferralReward(referrer._id, reward, {
        role: 'USER',
        refereeId: String(referee._id),
        referralLogId: String(log._id)
    });
    await ReferralLog.updateOne({ _id: log._id }, { $set: { status: 'credited' } });
    return { credited: true };
};
