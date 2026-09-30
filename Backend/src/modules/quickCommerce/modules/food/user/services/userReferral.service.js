import mongoose from 'mongoose';
import { inviteCodeFor } from '../../../../../../core/referral/inviteCode.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';
import { FoodReferralLog } from '../../admin/models/referralLog.model.js';
import { buildReferralLinkFromTemplate } from '../../delivery/services/deliveryReferral.service.js';

import { referralSettingsFor } from '../../../../../../core/referral/referralSettings.service.js';
// The platform's own referral programme: the one /login credits.
import * as platformReferral from '../../../../../food/user/services/userReferral.service.js';
import { FoodReferralSettings as PlatformReferralSettings } from '../../../../../food/admin/models/referralSettings.model.js';

/**
 * A customer who signed in on the platform refers people through the platform.
 *
 * The invite link is the platform sign-in (/login?ref=CODE), and the platform
 * login credits `ref` only when it is the referrer's PLATFORM account id (see
 * core/auth/auth.service.js). This service used to hand out the Quick account's
 * own code, which that login never recognises, and to count Quick's own
 * referrals, which nothing increments for such a customer -- so the screen
 * showed a code that paid no one and a count stuck at zero.
 *
 * For a linked customer the code is therefore the platform id and the numbers
 * are the platform's (referrals, earnings in the one shared wallet, reward and
 * limit). A Quick-only account with no platform link keeps the old behaviour.
 */
const platformIdFor = async (oid) => {
    const row = await FoodUser.findById(oid).select('platformUserId').lean();
    const pid = row?.platformUserId ? String(row.platformUserId) : '';
    return mongoose.Types.ObjectId.isValid(pid) ? pid : null;
};

const platformInvite = async (pid) => {
    const [settings, code] = await Promise.all([
        referralSettingsFor('food', PlatformReferralSettings),
        inviteCodeFor(pid),
    ]);
    // The person's one invite code, the same on every service's screen.
    const shared = String(code || pid);
    return {
        referralCode: shared,
        referralLink: `/login?ref=${encodeURIComponent(shared)}`,
        referralLimit: Math.max(0, Number(settings?.referralLimitUser) || 0),
    };
};

export const getUserReferralStats = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const pid = await platformIdFor(oid);
    if (pid) {
        const [stats, invite] = await Promise.all([platformReferral.getUserReferralStats(pid), platformInvite(pid)]);
        return { ...stats, ...invite };
    }
    const [user, wallet, settingsDoc] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        referralSettingsFor('quickCommerce', FoodReferralSettings)
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
    const pid = await platformIdFor(oid);
    if (pid) {
        const [details, invite] = await Promise.all([platformReferral.getUserReferralDetails(pid), platformInvite(pid)]);
        return { ...details, stats: { ...(details?.stats || {}), ...invite } };
    }
    const [user, wallet, settingsDoc, logs] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        referralSettingsFor('quickCommerce', FoodReferralSettings),
        FoodReferralLog.find({ referrerId: oid, role: 'USER' })
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
        ? await FoodUser.find({ _id: { $in: refereeIds } })
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
