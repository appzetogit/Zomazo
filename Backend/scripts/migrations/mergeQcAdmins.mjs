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
    const [{ quickAdmins }, { runAdminMerge }] = await Promise.all([
        import('../../src/core/admin/quickAdmin.js'),
        import('../../src/core/admin/serviceAdmin.js'),
    ]);
    return runAdminMerge(quickAdmins, { apply, dropOld, log, renameWhenIdle });
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
