/**
 * Merge Quick commerce customers (qc_users) into the shared `users` collection.
 *
 *   node scripts/migrations/mergeQcUsers.mjs              # dry run (default): prints what would happen
 *   node scripts/migrations/mergeQcUsers.mjs --apply      # merges every row
 *   node scripts/migrations/mergeQcUsers.mjs --drop-old   # later, once verified: retires qc_users
 *
 * Deploy the code first, then run --apply: the new code serves both a merged
 * and a not-yet-merged customer (it merges one on their first request), the
 * old code cannot serve a merged one.
 *
 * Per row (core/identity/quickCustomer.js mergeQcUser):
 *   - its platform account: platformUserId, else the same last ten digits of
 *     the phone, else one made with the row's own _id;
 *   - Quick's fields copied onto it where it has nothing (name, email, photo,
 *     birthday, gender, push tokens), Quick's counters and flags under their
 *     own names (quickReferralCount, quickReferredBy, quickBlocked,
 *     quickJoinedAt, tokenVersion, rider rating), addresses into the one book;
 *   - every reference to the old id rewritten (QC_USER_REFS: orders, carts,
 *     favourites, tickets, returns, refunds, referral logs, chat, coupons,
 *     payments, wallet ...), the pair kept in qc_user_id_map.
 * Idempotent and resumable: run it again after a stop and it finishes the job.
 * A reference a unique index will not take (a second wallet or cart for the
 * same person) is left on the old id and reported as a clash.
 *
 * --drop-old refuses unless every row is merged and no reference to a moved id
 * is left; it then RENAMES qc_users to qc_users_premerge_<date> (drop that by
 * hand when you are sure). The id map stays: old tokens and codes keep resolving.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { renameWhenIdle } from './renameCollection.mjs';

export async function mergeQcUsers({ apply = false, dropOld = false, log = console.log } = {}) {
    const [{ quickCustomers }, { runCustomerMerge }] = await Promise.all([
        import('../../src/core/identity/quickCustomer.js'),
        import('../../src/core/identity/serviceCustomer.js'),
    ]);
    return runCustomerMerge(quickCustomers, { apply, dropOld, log, renameWhenIdle });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('mergeQcUsers: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await mergeQcUsers({ apply: process.argv.includes('--apply'), dropOld: process.argv.includes('--drop-old') });
    } finally {
        await mongoose.disconnect();
    }
}
