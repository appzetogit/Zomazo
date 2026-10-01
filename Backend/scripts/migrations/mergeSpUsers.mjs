/**
 * Merge Services customers (sp_users) into the shared `users` collection, with
 * a Services profile (sp_profiles) under the same _id.
 *
 *   node scripts/migrations/mergeSpUsers.mjs              # dry run (default): prints what would happen
 *   node scripts/migrations/mergeSpUsers.mjs --apply      # merges every row
 *   node scripts/migrations/mergeSpUsers.mjs --drop-old   # later, once verified: retires sp_users
 *
 * Deploy the code first, then run --apply: the new code merges a waiting
 * customer on their first request or sign-in; the old code reads sp_users only.
 *
 * Per row (core/identity/spCustomer.js, engine core/identity/serviceCustomer.js):
 *   - its platform account: platformUserId, else the same last ten digits of
 *     the phone, else one made with the row's own _id;
 *   - blanks filled (name, email, photo), push tokens merged; Services fields as
 *     spJoinedAt, spBlocked, spReferredBy, spReferralCount, spReferralCode;
 *   - a Services profile under the account's _id with what only Services keeps
 *     (penalty bucket, plans, settings, booking stats, favourites, its address
 *     list, session id, password hash);
 *   - a balance held only on the Services record (customers with no platform
 *     account until now) moved into the shared wallet once;
 *   - every reference to the old id rewritten (SP_USER_REFS: bookings, cart,
 *     coupon uses, notifications, referral logs, reviews, scrap, tokens,
 *     transactions, payments, wallet ...), the pair kept in sp_user_id_map.
 * Idempotent and resumable. --drop-old refuses while any row is unmerged or any
 * reference to a moved id is left; it renames sp_users (never drops it).
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { renameWhenIdle } from './renameCollection.mjs';

export async function mergeSpUsers({ apply = false, dropOld = false, log = console.log } = {}) {
    const [{ spCustomers }, { runCustomerMerge }] = await Promise.all([
        import('../../src/core/identity/spCustomer.js'),
        import('../../src/core/identity/serviceCustomer.js'),
    ]);
    return runCustomerMerge(spCustomers, { apply, dropOld, log, renameWhenIdle });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('mergeSpUsers: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await mergeSpUsers({ apply: process.argv.includes('--apply'), dropOld: process.argv.includes('--drop-old') });
    } finally {
        await mongoose.disconnect();
    }
}
