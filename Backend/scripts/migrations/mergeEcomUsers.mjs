/**
 * Merge Shop (e-commerce) customers (ecom_users) into the shared `users` collection.
 *
 *   node scripts/migrations/mergeEcomUsers.mjs              # dry run (default): prints what would happen
 *   node scripts/migrations/mergeEcomUsers.mjs --apply      # merges every row
 *   node scripts/migrations/mergeEcomUsers.mjs --drop-old   # later, once verified: retires ecom_users
 *
 * Deploy the code first, then run --apply: the new code serves both a merged
 * and a not-yet-merged customer (it merges one on their first request); the
 * old code cannot serve a merged one.
 *
 * Per row (core/identity/shopCustomer.js, engine core/identity/serviceCustomer.js):
 *   - its platform account: platformUserId, else the same last ten digits of
 *     the phone, else one made with the row's own _id;
 *   - blanks filled (name, email, photo, birthday, gender), push tokens and
 *     addresses merged, the Shop's own fields as shopJoinedAt, shopBlocked,
 *     shopReferredBy, shopReferralCount, shopTokenVersion;
 *   - every reference to the old id rewritten (SHOP_USER_REFS: orders,
 *     checkouts, carts, favourites, saved-for-later, reviews, coins, spins,
 *     returns, refunds, referral logs, notifications, wallet ...), the pair
 *     kept in ecom_user_id_map.
 * Idempotent and resumable. A reference a unique index will not take (a
 * second cart or wallet for the same person) is left on the old id and
 * reported as a clash. --drop-old refuses while one is left, then renames
 * ecom_users (it never drops it).
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { renameWhenIdle } from './renameCollection.mjs';

export async function mergeEcomUsers({ apply = false, dropOld = false, log = console.log } = {}) {
    const [{ shopCustomers }, { runCustomerMerge }] = await Promise.all([
        import('../../src/core/identity/shopCustomer.js'),
        import('../../src/core/identity/serviceCustomer.js'),
    ]);
    return runCustomerMerge(shopCustomers, { apply, dropOld, log, renameWhenIdle });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('mergeEcomUsers: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await mergeEcomUsers({ apply: process.argv.includes('--apply'), dropOld: process.argv.includes('--drop-old') });
    } finally {
        await mongoose.disconnect();
    }
}
