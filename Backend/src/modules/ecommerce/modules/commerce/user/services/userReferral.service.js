import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { User } from '../../../../core/users/user.model.js';
import { UserWallet } from '../models/userWallet.model.js';
import { ReferralSettings } from '../../admin/models/referralSettings.model.js';
import { ReferralLog } from '../../admin/models/referralLog.model.js';
import { buildReferralLinkFromTemplate } from '../../delivery/services/deliveryReferral.service.js';
import { creditReferralReward } from './userWallet.service.js';
import { referralSettingsFor } from '../../../../../../core/referral/referralSettings.service.js';

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

    return {
        referralCode: String(user?.referralCode || user?._id || ''),
        referralLink: buildReferralLinkFromTemplate(
            settingsDoc?.referralLinkUser,
            user?.referralCode || user?._id,
            ''
        ),
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
            referralCode: String(user?.referralCode || user?._id || ''),
            referralLink: buildReferralLinkFromTemplate(
                settingsDoc?.referralLinkUser,
                user?.referralCode || user?._id,
                ''
            ),
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
    const referee = await User.findById(refereeId).select('_id referredBy platformUserId').lean();
    if (!referee) return { credited: false, reason: 'no_referee' };
    if (referee.referredBy) return { credited: false, reason: 'already_referred' };

    const or = [{ referralCode: code }];
    if (mongoose.Types.ObjectId.isValid(code)) {
        const oid = new mongoose.Types.ObjectId(code);
        or.push({ _id: oid }, { platformUserId: oid });
    }
    const referrer = await User.findOne({ $or: or }).select('_id platformUserId').lean();
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
            status: 'pending'
        });
    } catch (err) {
        if (err?.code === 11000) return { credited: false, reason: 'already_referred' };
        throw err;
    }

    const claimed = reward > 0 && limit > 0
        ? await User.updateOne(
            { _id: referrer._id, $or: [{ referralCount: { $lt: limit } }, { referralCount: { $exists: false } }] },
            { $inc: { referralCount: 1 } }
        )
        : null;
    if (claimed?.modifiedCount !== 1) {
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
