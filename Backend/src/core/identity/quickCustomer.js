/**
 * Quick commerce customers live in the shared `users` collection.
 *
 * Quick's merge configuration (core/identity/serviceCustomer.js has the how):
 * qc_users rows -> users, Quick's own fields as quickJoinedAt, quickBlocked,
 * quickReferredBy, quickReferralCount, tokenVersion (Quick's OTP sign-in) and
 * the rider rating; the map is qc_user_id_map. scripts/migrations/mergeQcUsers.mjs
 * runs it for every row; until then a customer is merged on first use
 * (resolveQuickCustomerId).
 */
import { createCustomerMerge, MERGE_DONE_KEY } from './serviceCustomer.js';

export { refQuery, rewriteRef } from './serviceCustomer.js';

export const QC_USER_ID_MAP = 'qc_user_id_map';
export const QC_MERGE_DONE_KEY = MERGE_DONE_KEY;

/* Every stored reference to a Quick customer's id (see serviceCustomer.js). */
export const QC_USER_REFS = Object.freeze([
    { c: 'qc_orders', f: 'userId' },
    { c: 'qc_orders', arr: 'statusHistory', f: 'byId' },
    { c: 'qc_prescription_requests', f: 'userId' },
    { c: 'qc_referral_logs', f: 'referrerId' },
    { c: 'qc_referral_logs', f: 'refereeId' },
    { c: 'qc_refresh_tokens', f: 'userId' },
    { c: 'qc_refunds', f: 'userId' },
    { c: 'qc_returns', f: 'userId' },
    { c: 'qc_safety_emergency_reports', f: 'userId' },
    { c: 'qc_support_tickets', f: 'userId' },
    { c: 'qc_transactions', f: 'userId' },
    { c: 'qc_transactions', arr: 'history', f: 'recordedBy.id' },
    { c: 'qc_user_carts', f: 'userId', unique: true },
    { c: 'qc_user_favorites', f: 'userId', unique: true },
    { c: 'qc_feedback_experiences', f: 'userId' },
    { c: 'qc_chat_messages', f: 'senderId' },
    { c: 'qc_chat_messages', f: 'recipientId' },
    { c: 'qc_broadcast_notifications', list: 'targetIds' },
    { c: 'qc_broadcast_notifications', arr: 'targets', f: 'ownerId' },
    { c: 'qc_entity_transactions', f: 'entityId' },
    { c: 'qc_settlements', f: 'entityId' },
    // Quick's payment records once copied to the core collections (mergeQcPayments).
    { c: 'refunds', f: 'userId' },
    { c: 'transactions', f: 'entityId' },
    // Shared collections Quick writes with its own ids.
    { c: 'food_offer_usages', f: 'userId' },
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
    { c: 'users', f: 'quickReferredBy' },
]);

export const quickCustomers = createCustomerMerge({
    collection: 'qc_users',
    mapCollection: QC_USER_ID_MAP,
    refs: QC_USER_REFS,
    payerModel: 'QCUser',
    fields: {
        joinedAt: 'quickJoinedAt',
        blocked: 'quickBlocked',
        referredBy: 'quickReferredBy',
        referralCount: 'quickReferralCount',
        tokenVersion: 'tokenVersion',
        mergedIds: 'mergedQcIds',
    },
    created: (row) => ({ rating: Number(row.rating) || 0, totalRatings: Number(row.totalRatings) || 0 }),
    linked: (row, account) => (!(Number(account.totalRatings) > 0) && Number(row.totalRatings) > 0
        ? { rating: Number(row.rating) || 0, totalRatings: Number(row.totalRatings) }
        : {}),
});

export const countQcUserRefs = (id) => quickCustomers.countRefs(id);
export const mappedQuickId = (id) => quickCustomers.mappedId(id);
export const mergeQcUser = (row, options) => quickCustomers.mergeRow(row, options);
export const resolveQuickCustomerId = (id) => quickCustomers.resolveId(id);
export const quickCustomerForPhone = (phone, options) => quickCustomers.customerForPhone(phone, options);
export const clearQuickCustomerCache = () => quickCustomers.clearCache();
