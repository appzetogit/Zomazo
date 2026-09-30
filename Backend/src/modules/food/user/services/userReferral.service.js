import mongoose from 'mongoose';
import { invitesOfPerson } from '../../../../core/referral/referralActivity.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodUserWallet } from '../models/userWallet.model.js';
import { FoodReferralSettings } from '../../admin/models/referralSettings.model.js';

import { referralSettingsFor } from '../../../../core/referral/referralSettings.service.js';
export const getUserReferralStats = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const [user, wallet, settingsDoc] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        referralSettingsFor('food', FoodReferralSettings)
    ]);

    return {
        referralCount: Number(user?.referralCount) || 0,
        totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
        rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0)
    };
};

export const getUserReferralDetails = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }

    const oid = new mongoose.Types.ObjectId(id);
    // Every service's invites: the person has one code, so a friend may have
    // joined through any of them (core/referral/referralActivity.service.js).
    const [user, wallet, settingsDoc, invitedFriends] = await Promise.all([
        FoodUser.findById(oid).select('_id referralCount referralCode').lean(),
        FoodUserWallet.findOne({ userId: oid }).select('referralEarnings').lean(),
        referralSettingsFor('food', FoodReferralSettings),
        invitesOfPerson(oid)
    ]);

    const totalInvited = invitedFriends.length;
    const creditedCount = invitedFriends.filter((entry) => entry.status === 'credited').length;
    const pendingCount = invitedFriends.filter((entry) => entry.status === 'pending').length;
    const rejectedCount = invitedFriends.filter((entry) => entry.status === 'rejected').length;

    return {
        stats: {
            referralCount: Number(user?.referralCount) || 0,
            totalReferralEarnings: Number(wallet?.referralEarnings) || 0,
            rewardAmount: Math.max(0, Number(settingsDoc?.referralRewardUser) || 0),
            totalInvited,
            creditedCount,
            pendingCount,
            rejectedCount
        },
        invitedFriends
    };
};
