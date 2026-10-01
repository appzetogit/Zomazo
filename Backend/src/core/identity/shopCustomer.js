/**
 * Shop (e-commerce) customers live in the shared `users` collection.
 *
 * The Shop's merge configuration (core/identity/serviceCustomer.js has the
 * how): ecom_users rows -> users. The Shop's own fields keep shop* names so
 * they never touch another service's: shopJoinedAt (the Shop's admin lists
 * only these), shopBlocked (the Shop admin's switch; isActive is every app),
 * shopReferredBy / shopReferralCount (the Shop's referral programme) and
 * shopTokenVersion (the Shop's own single-device sign-in -- separate from
 * Quick's, so signing in to one does not sign the other out). Coins, cart,
 * orders, reviews and the rest are rows keyed by the customer id: they are
 * rewritten (SHOP_USER_REFS). The map is ecom_user_id_map;
 * scripts/migrations/mergeEcomUsers.mjs runs it for every row, and until then a
 * customer is merged on first use (resolveShopCustomerId).
 */
import { createCustomerMerge } from './serviceCustomer.js';

export const ECOM_USER_ID_MAP = 'ecom_user_id_map';

/* Every stored reference to a Shop customer's id (see serviceCustomer.js). */
export const SHOP_USER_REFS = Object.freeze([
    { c: 'ecom_orders', f: 'userId' },
    { c: 'ecom_orders', arr: 'statusHistory', f: 'byId' },
    { c: 'ecom_checkouts', f: 'userId' },
    { c: 'ecom_order_transactions', f: 'userId' },
    { c: 'ecom_order_transactions', arr: 'history', f: 'recordedBy.id' },
    { c: 'ecom_payments', f: 'userId' },
    { c: 'ecom_refunds', f: 'userId' },
    { c: 'ecom_return_requests', f: 'userId' },
    { c: 'ecom_transactions', f: 'entityId' },
    { c: 'ecom_settlements', f: 'entityId' },
    { c: 'ecom_user_carts', f: 'userId', unique: true },
    { c: 'ecom_user_favorites', f: 'userId', unique: true },
    { c: 'ecom_user_saved_for_later', f: 'userId', unique: true },
    { c: 'ecom_user_wallets', f: 'userId', unique: true },
    { c: 'ecom_product_reviews', f: 'userId' },
    { c: 'ecom_product_reviews', list: 'helpfulVoters' },
    { c: 'ecom_product_reviews', arr: 'reports', f: 'byId' },
    { c: 'ecom_coin_lots', f: 'userId' },
    { c: 'ecom_coin_ledger', f: 'userId' },
    { c: 'ecom_spin_results', f: 'userId' },
    { c: 'ecom_offer_usages', f: 'userId' },
    { c: 'ecom_first_order_claims', f: 'ownerUserId' },
    { c: 'ecom_first_order_claims', f: 'userId' },
    { c: 'ecom_referral_logs', f: 'referrerId' },
    { c: 'ecom_referral_logs', f: 'refereeId' },
    { c: 'ecom_refresh_tokens', f: 'userId' },
    { c: 'ecom_support_tickets', f: 'userId' },
    { c: 'ecom_safety_emergency_reports', f: 'userId' },
    { c: 'ecom_feedback_experiences', f: 'userId' },
    { c: 'ecom_ai_conversations', f: 'userId' },
    { c: 'ecom_ai_usage_daily', f: 'userId' },
    { c: 'ecom_notifications', f: 'ownerId' },
    { c: 'ecom_notification_preferences', f: 'ownerId', unique: true },
    { c: 'ecom_notification_broadcasts', list: 'targetIds' },
    { c: 'ecom_notification_broadcasts', arr: 'targets', f: 'ownerId' },
    { c: 'ecom_push_campaign_deliveries', f: 'ownerId' },
    // Shared collections the Shop writes with its own ids.
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
    { c: 'users', f: 'shopReferredBy' },
]);

export const shopCustomers = createCustomerMerge({
    collection: 'ecom_users',
    mapCollection: ECOM_USER_ID_MAP,
    refs: SHOP_USER_REFS,
    fields: {
        joinedAt: 'shopJoinedAt',
        blocked: 'shopBlocked',
        referredBy: 'shopReferredBy',
        referralCount: 'shopReferralCount',
        tokenVersion: 'shopTokenVersion',
        mergedIds: 'mergedEcomIds',
    },
});

export const resolveShopCustomerId = (id) => shopCustomers.resolveId(id);
export const shopCustomerForPhone = (phone, options) => shopCustomers.customerForPhone(phone, options);
export const mergeEcomUser = (row, options) => shopCustomers.mergeRow(row, options);
export const clearShopCustomerCache = () => shopCustomers.clearCache();
