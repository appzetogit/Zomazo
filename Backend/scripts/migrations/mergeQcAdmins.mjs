/**
 * Merge Quick commerce admins (qc_admins) into the shared `admins` collection.
 *
 *   node scripts/migrations/mergeQcAdmins.mjs              # dry run (default)
 *   node scripts/migrations/mergeQcAdmins.mjs --apply      # merges every row
 *   node scripts/migrations/mergeQcAdmins.mjs --drop-old   # later: retires qc_admins
 *
 * Deploy the code first, then --apply: the new code merges a waiting admin on
 * their first request or sign-in; the old code cannot see a merged one.
 *
 * Per row (core/admin/quickAdmin.js mergeQcAdmin):
 *   - an email already in `admins` is the same person: that account keeps its
 *     password and permissions and gains the Quick and Medical panels (listed
 *     as REVIEW below -- check what they should see in Quick);
 *   - otherwise a platform sub-admin of the Quick module is made with the
 *     row's own _id and password hash: servicesAccess quickCommerce + medical,
 *     a Quick super_admin with write on every resource the Quick panel offers,
 *     a sub_admin with its sections mapped (QC_SECTION_RESOURCES);
 *   - audit fields and sessions naming the old id are rewritten
 *     (QC_ADMIN_REFS); qc_admin_id_map keeps old -> new.
 * Idempotent and resumable.
 *
 * --drop-old refuses unless every row is merged and no reference to a moved id
 * is left; it renames qc_admins to qc_admins_premerge_<date>.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { renameWhenIdle } from './renameCollection.mjs';

export async function mergeQcAdmins({ apply = false, dropOld = false, log = console.log } = {}) {
    const { mergeQcAdmin, countQcAdminRefs, QC_ADMIN_ID_MAP } = await import('../../src/core/admin/quickAdmin.js');
    const db = mongoose.connection;
    if (!(await db.db.listCollections({ name: 'qc_admins' }).toArray()).length) {
        log('qc_admins does not exist: nothing to merge.');
        return { rows: 0 };
    }

    if (dropOld) {
        const unmerged = await db.collection('qc_admins').countDocuments({ mergedAt: { $exists: false } });
        if (unmerged) {
            log(`Refusing --drop-old: ${unmerged} qc_admins rows are not merged. Run --apply first.`);
            return { refused: true, unmerged };
        }
        let leftover = 0;
        for await (const m of db.collection(QC_ADMIN_ID_MAP).find({ doneAt: { $exists: true } })) {
            if (String(m._id) === String(m.platformId)) continue;
            const n = Object.values(await countQcAdminRefs(m._id)).reduce((a, b) => a + b, 0);
            leftover += n;
        }
        if (leftover) {
            log(`Refusing --drop-old: ${leftover} stored references still name old qc_admins ids.`);
            return { refused: true, leftover };
        }
        const name = `qc_admins_premerge_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
        await renameWhenIdle(db.collection('qc_admins'), name);
        log(`qc_admins renamed to ${name}. Drop it by hand when sure; qc_admin_id_map stays.`);
        return { renamed: name };
    }

    const totals = { rows: 0, already: 0, linked: 0, created: 0, review: [], refs: {} };
    for await (const row of db.collection('qc_admins').find({})) {
        totals.rows += 1;
        const r = await mergeQcAdmin(row, { dryRun: !apply });
        if (!r) continue;
        totals[r.action] += 1;
        if (r.action === 'linked') totals.review.push(row.email);
        for (const [k, n] of Object.entries(r.refs || {})) totals.refs[k] = (totals.refs[k] || 0) + n;
    }
    if (apply) totals.leftUnmerged = await db.collection('qc_admins').countDocuments({ mergedAt: { $exists: false } });

    log(`${apply ? 'Merged' : 'Dry run (nothing written)'}: ${totals.rows} qc_admins rows`);
    log(`  already merged ${totals.already}, ${apply ? '' : 'would be '}linked by email ${totals.linked}, ${apply ? '' : 'would be '}made ${totals.created}`);
    for (const [k, n] of Object.entries(totals.refs).sort()) log(`    ${k}: ${n}`);
    if (totals.review.length) log(`  REVIEW (kept their platform permissions, gained Quick + Medical): ${totals.review.join(', ')}`);
    if (apply) log(totals.leftUnmerged ? `  ${totals.leftUnmerged} rows still unmerged -- run again` : '  every row merged');
    return totals;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('mergeQcAdmins: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await mergeQcAdmins({ apply: process.argv.includes('--apply'), dropOld: process.argv.includes('--drop-old') });
    } finally {
        await mongoose.disconnect();
    }
}
