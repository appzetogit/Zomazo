import mongoose from 'mongoose';
import { createCustomerMerge } from './serviceCustomer.js';

/**
 * Services (service provider) customers: one identity in `users`, plus a small
 * Services profile.
 *
 * The Services merge configuration (core/identity/serviceCustomer.js has the
 * how): sp_users rows -> users. The account carries the identity and the
 * Services fields other services may read, under sp* names: spJoinedAt,
 * spBlocked (the Services admin's switch -- isActive stays every app's),
 * spReferredBy, spReferralCount and spReferralCode (the SPxxxxxx code people
 * already hold).
 *
 * What only Services uses stays on its side, in `sp_profiles`, one row per
 * person under the SAME _id as the account (modules/serviceProvider/models/User.js
 * is that collection): the unpaid cancellation-fee bucket (wallet.penalty),
 * plans, settings, booking stats, favourites, its address list (another shape
 * than the platform's), the session id and -- for the Services app's own
 * phone + password sign-in, which is still mounted -- the password hash.
 * Money is NOT kept there: wallet.balance is the customer's one shared wallet
 * (utils/sharedWalletBridge.js); a balance held only on a Services record, by
 * someone with no platform account until now, is moved into it once.
 *
 * The map is sp_user_id_map; scripts/migrations/mergeSpUsers.mjs runs it, and
 * until then a customer is merged on first use (resolveSpCustomerId).
 */

export const SP_USER_ID_MAP = 'sp_user_id_map';
export const SP_PROFILES = 'sp_profiles';

/* Every stored reference to a Services customer's id (see serviceCustomer.js). */
export const SP_USER_REFS = Object.freeze([
    { c: 'sp_bookings', f: 'userId' },
    { c: 'sp_bookings', f: 'cashCollectorId' },
    { c: 'sp_carts', f: 'userId', unique: true },
    { c: 'sp_coupon_usages', f: 'userId' },
    { c: 'sp_notifications', f: 'userId' },
    { c: 'sp_referral_logs', f: 'referrerId' },
    { c: 'sp_referral_logs', f: 'refereeId' },
    { c: 'sp_reviews', f: 'userId' },
    { c: 'sp_scraps', f: 'userId' },
    { c: 'sp_tokens', f: 'userId' },
    { c: 'sp_transactions', f: 'userId' },
    // Shared collections Services writes with its own ids.
    { c: 'food_notifications', f: 'ownerId' },
    { c: 'payments', f: 'payerId' },
    { c: 'food_user_wallets', f: 'userId', unique: true },
    { c: 'platform_referral_claims', f: 'referrerId' },
    { c: 'platform_referral_claims', f: 'refereeId' },
    { c: 'platform_support_messages', f: 'authorId' },
    { c: 'platform_loyalty_accounts', f: 'platformUserId', unique: true },
    { c: 'platform_loyalty_ledger', f: 'platformUserId' },
    { c: 'platform_coupon_uses', f: 'platformUserId', unique: true },
    { c: 'platform_cashback_offer_uses', f: 'platformUserId', unique: true },
    { c: 'users', f: 'spReferredBy' },
]);

const coll = (name) => mongoose.connection.collection(name);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** What only Services keeps, from an sp_users row, for its profile under the account's _id. */
export function profileFromRow(row, platformId) {
    const {
        _id, platformUserId, referralCode, referredBy, referralCount,
        mergedAt, mergedInto, addressesMergedAt, __v, ...rest
    } = row;
    return {
        ...rest,
        _id: platformId,
        role: row.role || 'user',
        platformUserId: platformId,
        // The balance lives in the shared wallet; the penalty bucket stays here.
        wallet: { balance: 0, penalty: round2(row.wallet?.penalty) },
    };
}

/** A balance kept only on a Services record moved into the shared wallet, once. */
async function moveSpBalance(row, platformId) {
    const amount = round2(row.wallet?.balance);
    if (!(amount > 0)) return;
    const key = `sp-wallet-move:${row._id}`;
    const now = new Date();
    try {
        await coll('food_user_wallets').updateOne(
            { userId: platformId, 'transactions.referenceKey': { $ne: key } },
            {
                $inc: { balance: amount },
                $push: {
                    transactions: {
                        $each: [{
                            _id: new mongoose.Types.ObjectId(),
                            type: 'addition', kind: 'credit', amount, status: 'Completed',
                            description: 'Services balance moved to your wallet', referenceKey: key,
                            metadata: { vertical: 'serviceProvider', spUserId: String(row._id) },
                            createdAt: now,
                        }],
                        $position: 0,
                    },
                },
                $setOnInsert: { userId: platformId, createdAt: now },
                $set: { updatedAt: now },
            },
            { upsert: true },
        );
    } catch (err) {
        // The wallet exists and already holds this move (the $ne filter missed it): moved once.
        if (err?.code !== 11000) throw err;
    }
}

async function keepProfile(row, platformId, { created }) {
    const profiles = coll(SP_PROFILES);
    const existing = await profiles.findOne({ _id: platformId }, { projection: { _id: 1, mergedSpIds: 1 } });
    if (!existing) {
        try {
            await profiles.insertOne({ ...profileFromRow(row, platformId), mergedSpIds: [row._id] });
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // A profile with this phone under another id: an earlier, cut-short run
            // or a second row of the same person. Fold into the account's own.
            await profiles.updateOne({ _id: platformId }, { $setOnInsert: { ...profileFromRow(row, platformId), phone: `${row.phone}#${row._id}` } }, { upsert: true });
        }
    } else if (!(existing.mergedSpIds || []).some((id) => String(id) === String(row._id))) {
        // A second Services row of the same person: add up what adds up.
        await profiles.updateOne({ _id: platformId }, {
            $inc: {
                'wallet.penalty': round2(row.wallet?.penalty),
                totalBookings: Number(row.totalBookings) || 0,
                completedBookings: Number(row.completedBookings) || 0,
                cancelledBookings: Number(row.cancelledBookings) || 0,
            },
            $addToSet: { favouriteServices: { $each: row.favouriteServices || [] }, mergedSpIds: row._id },
        });
    }
    // Before the merge only a customer with a platform account had the shared
    // wallet; anyone else's money was on their Services record.
    if (created) await moveSpBalance(row, platformId);
}

export const spCustomers = createCustomerMerge({
    collection: 'sp_users',
    mapCollection: SP_USER_ID_MAP,
    refs: SP_USER_REFS,
    copyAddresses: false,
    fields: {
        joinedAt: 'spJoinedAt',
        blocked: 'spBlocked',
        referredBy: 'spReferredBy',
        referralCount: 'spReferralCount',
        tokenVersion: null,
        mergedIds: 'mergedSpIds',
    },
    created: (row) => ({
        profileImage: row.profilePhoto || '',
        isVerified: row.isPhoneVerified === true,
        referralCode: String(row._id),
        ...(row.referralCode ? { spReferralCode: String(row.referralCode).toUpperCase() } : {}),
    }),
    linked: (row, account) => ({
        ...(!account.profileImage && row.profilePhoto ? { profileImage: row.profilePhoto } : {}),
        ...(!account.spReferralCode && row.referralCode ? { spReferralCode: String(row.referralCode).toUpperCase() } : {}),
    }),
    afterMerge: keepProfile,
});

export const resolveSpCustomerId = (id) => spCustomers.resolveId(id);
export const mergeSpUser = (row, options) => spCustomers.mergeRow(row, options);
export const clearSpCustomerCache = () => spCustomers.clearCache();
