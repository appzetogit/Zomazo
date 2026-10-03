/**
 * Bring the on/off flags of existing accounts into agreement, now that `users`
 * and `admins` each have one schema (core/users/user.model.js,
 * core/admin/admin.model.js).
 *
 *   node scripts/migrations/reconcileAccountFlags.mjs            # dry run (default): counts what it would change
 *   node scripts/migrations/reconcileAccountFlags.mjs --apply    # writes; safe to re-run
 *
 * admins: taxi switched an admin off with `active: false` / `status: 'inactive'`,
 *   which no other panel read, so the admin could still open Food, Quick, the
 *   Shop and Master. Off in any spelling becomes off in all three. (Nothing is
 *   switched ON: an admin off in one spelling stays off.)
 *
 * users: taxi's admin delete set `deletedAt` without `isActive: false`, so a
 *   deleted customer could still sign in to Food, Quick and the Shop. Deleted
 *   rows get isActive false. Taxi's own `active` switch is left alone: it is
 *   taxi's block, like quickBlocked and shopBlocked.
 *
 * Deploy the code first: from then on admin saves keep the flags in step and
 * taxi's delete sets isActive itself. Every check already honours all three
 * admin spellings (isAdminActive), so this is tidiness, not the fix.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

export const ADMIN_OFF_SOMEWHERE = {
    $or: [{ isActive: false }, { active: false }, { status: 'inactive' }],
};
const ADMIN_NOT_OFF_EVERYWHERE = {
    $or: [{ isActive: { $ne: false } }, { active: { $ne: false } }, { status: { $ne: 'inactive' } }],
};
export const DELETED_BUT_ACTIVE = { deletedAt: { $ne: null }, isActive: { $ne: false } };

export async function reconcileAccountFlags({ apply = false, log = console.log, db = mongoose.connection } = {}) {
    const admins = db.collection('admins');
    const users = db.collection('users');

    const adminFilter = { $and: [ADMIN_OFF_SOMEWHERE, ADMIN_NOT_OFF_EVERYWHERE] };
    const out = {
        admins: await admins.countDocuments(adminFilter),
        users: await users.countDocuments(DELETED_BUT_ACTIVE),
    };

    if (apply) {
        const a = await admins.updateMany(adminFilter, { $set: { isActive: false, active: false, status: 'inactive' } });
        const u = await users.updateMany(DELETED_BUT_ACTIVE, { $set: { isActive: false } });
        out.admins = a.modifiedCount;
        out.users = u.modifiedCount;
    }

    log(`admins: ${out.admins} ${apply ? 'switched off in every spelling' : 'off in one spelling but not all'}`);
    log(`users: ${out.users} ${apply ? 'deleted accounts switched off' : 'deleted but still active'}`);
    if (!apply) log('Dry run: nothing written. Re-run with --apply.');
    return out;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('reconcileAccountFlags: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await reconcileAccountFlags({ apply: process.argv.includes('--apply') });
    } finally {
        await mongoose.disconnect();
    }
}
