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
    const { mergeQcUser, countQcUserRefs, QC_USER_ID_MAP, QC_MERGE_DONE_KEY, QC_USER_REFS, clearQuickCustomerCache } =
        await import('../../src/core/identity/quickCustomer.js');
    const db = mongoose.connection;
    const exists = (await db.db.listCollections({ name: 'qc_users' }).toArray()).length > 0;
    if (!exists) {
        log('qc_users does not exist: nothing to merge.');
        return { rows: 0 };
    }

    if (dropOld) return retire({ db, log, countQcUserRefs, QC_USER_ID_MAP, QC_USER_REFS });

    const totals = { rows: 0, already: 0, linked: 0, created: 0, clashes: 0, refs: {} };
    for await (const row of db.collection('qc_users').find({})) {
        totals.rows += 1;
        const r = await mergeQcUser(row, { dryRun: !apply });
        if (!r) continue;
        totals[r.action] += 1;
        totals.clashes += r.clashes || 0;
        for (const [k, n] of Object.entries(r.refs || {})) totals.refs[k] = (totals.refs[k] || 0) + n;
        if (r.clashes) log(`  clash: qc ${r.qcId} -> ${r.platformId}: ${JSON.stringify(r.refs)}`);
    }

    if (apply) {
        const left = await db.collection('qc_users').countDocuments({ mergedAt: { $exists: false } });
        if (!left) {
            await db.collection(QC_USER_ID_MAP).updateOne(
                { _id: QC_MERGE_DONE_KEY },
                { $set: { at: new Date(), rows: totals.rows } },
                { upsert: true },
            );
        }
        totals.leftUnmerged = left;
        clearQuickCustomerCache();
    }

    log(`${apply ? 'Merged' : 'Dry run (nothing written)'}: ${totals.rows} qc_users rows`);
    log(`  already merged ${totals.already}, ${apply ? '' : 'would be '}linked to an existing account ${totals.linked}, ${apply ? '' : 'would be '}made as a new account ${totals.created}`);
    log(`  references ${apply ? 'rewritten' : 'to rewrite'}:`);
    for (const [k, n] of Object.entries(totals.refs).sort()) log(`    ${k}: ${n}`);
    if (totals.clashes) log(`  CLASHES left on the old id: ${totals.clashes} (see lines above; a second wallet/cart for one person)`);
    if (apply) log(totals.leftUnmerged ? `  ${totals.leftUnmerged} rows still unmerged -- run again` : '  every row merged');
    return totals;
}

async function retire({ db, log, countQcUserRefs, QC_USER_ID_MAP }) {
    const unmerged = await db.collection('qc_users').countDocuments({ mergedAt: { $exists: false } });
    if (unmerged) {
        log(`Refusing --drop-old: ${unmerged} qc_users rows are not merged. Run --apply first.`);
        return { refused: true, unmerged };
    }
    let leftover = 0;
    for await (const m of db.collection(QC_USER_ID_MAP).find({ doneAt: { $exists: true } })) {
        if (String(m._id) === String(m.platformId)) continue;
        const refs = await countQcUserRefs(m._id);
        const n = Object.values(refs).reduce((a, b) => a + b, 0);
        if (n) {
            leftover += n;
            log(`  still referenced: qc ${m._id}: ${JSON.stringify(refs)}`);
        }
    }
    if (leftover) {
        log(`Refusing --drop-old: ${leftover} stored references still name old qc_users ids (clashes to settle by hand).`);
        return { refused: true, leftover };
    }
    const name = `qc_users_premerge_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    await renameWhenIdle(db.collection('qc_users'), name);
    log(`qc_users renamed to ${name}. Drop it by hand when sure; qc_user_id_map stays.`);
    return { renamed: name };
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
