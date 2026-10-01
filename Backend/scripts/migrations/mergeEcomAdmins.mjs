/**
 * Merge Shop (e-commerce) admins (ecom_admins) into the shared `admins` collection.
 *
 *   node scripts/migrations/mergeEcomAdmins.mjs              # dry run (default)
 *   node scripts/migrations/mergeEcomAdmins.mjs --apply      # merges every row
 *   node scripts/migrations/mergeEcomAdmins.mjs --drop-old   # later: retires ecom_admins
 *
 * Deploy the code first, then --apply: the new code merges a waiting admin on
 * their first request or sign-in.
 *
 * Per row (core/admin/shopAdmin.js, engine core/admin/serviceAdmin.js):
 *   - an email already in `admins` is the same person: that account keeps its
 *     password and permissions and gains the Shop (listed as REVIEW -- check
 *     what they should see there);
 *   - otherwise a platform sub-admin of the 'ecommerce' module is made with the
 *     row's own _id and password hash: servicesAccess ['ecommerce'], a Shop
 *     super_admin with write on every resource the Shop panel is guarded by, a
 *     sub_admin with its sections mapped (SHOP_SECTION_RESOURCES);
 *   - audit fields and sessions naming the old id are rewritten
 *     (SHOP_ADMIN_REFS); ecom_admin_id_map keeps old -> new.
 * Idempotent and resumable. --drop-old refuses unless every row is merged and
 * no reference to a moved id is left; it renames ecom_admins.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { renameWhenIdle } from './renameCollection.mjs';

export async function mergeEcomAdmins({ apply = false, dropOld = false, log = console.log } = {}) {
    const [{ shopAdmins }, { runAdminMerge }] = await Promise.all([
        import('../../src/core/admin/shopAdmin.js'),
        import('../../src/core/admin/serviceAdmin.js'),
    ]);
    return runAdminMerge(shopAdmins, { apply, dropOld, log, renameWhenIdle });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('mergeEcomAdmins: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await mergeEcomAdmins({ apply: process.argv.includes('--apply'), dropOld: process.argv.includes('--drop-old') });
    } finally {
        await mongoose.disconnect();
    }
}
