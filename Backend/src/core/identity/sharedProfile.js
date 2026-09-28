import mongoose from 'mongoose';
import { platformUserIdFor } from './platformUser.js';

/**
 * One profile for the customer, on their platform account (`users`).
 *
 * Quick, the Shop and Services each kept their own name, email and photo on
 * their own customer rows, so a customer who changed their name in one app was
 * still their old name in the others. Those services now show the platform
 * account's details and save edits to it as well (still writing their own row,
 * which their other code reads).
 *
 * Only what describes the person is shared. Anything a service owns -- its
 * own flags, wallet or settings -- stays on its own row.
 */
export const SHARED_PROFILE_FIELDS = ['name', 'email', 'profileImage', 'dateOfBirth', 'anniversary', 'gender'];

const has = (v) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());

async function platformId(ownId) {
    const link = await platformUserIdFor(ownId);
    if (!link?.platformId || link.platformId === String(ownId)) return null;
    return link.platformId;
}

/**
 * `ownUser` with the platform account's details laid over it. Fields the
 * account has not filled in keep the service's own value. Never throws.
 *
 * @param {object} ownUser  the service's customer row (plain object, with _id)
 * @param {object} [aliases]  service field -> shared field, e.g. { profilePhoto: 'profileImage' }
 */
export async function withSharedProfile(ownUser, aliases = {}) {
    if (!ownUser?._id) return ownUser;
    try {
        const id = await platformId(ownUser._id);
        if (!id) return ownUser;
        const account = await mongoose.connection.collection('users').findOne(
            { _id: new mongoose.Types.ObjectId(id) },
            { projection: Object.fromEntries(SHARED_PROFILE_FIELDS.map((f) => [f, 1])) },
        );
        if (!account) return ownUser;
        const merged = { ...ownUser };
        for (const field of SHARED_PROFILE_FIELDS) {
            if (has(account[field])) merged[field] = account[field];
        }
        for (const [own, shared] of Object.entries(aliases)) {
            if (has(account[shared])) merged[own] = account[shared];
        }
        return merged;
    } catch {
        return ownUser;
    }
}

/**
 * Save the shared details a service just changed onto the platform account.
 * Only fields present in `changes` are written. Never throws: the service's own
 * save has already succeeded.
 *
 * @param {string} ownId
 * @param {object} changes  field -> new value (service field names)
 * @param {object} [aliases]  service field -> shared field
 */
export async function saveSharedProfile(ownId, changes = {}, aliases = {}) {
    try {
        const id = await platformId(ownId);
        if (!id) return;
        const set = {};
        for (const [key, value] of Object.entries(changes || {})) {
            const field = aliases[key] || key;
            if (SHARED_PROFILE_FIELDS.includes(field) && value !== undefined) set[field] = value;
        }
        if (!Object.keys(set).length) return;
        await mongoose.connection.collection('users').updateOne(
            { _id: new mongoose.Types.ObjectId(id) },
            { $set: { ...set, updatedAt: new Date() } },
        );
    } catch {
        // The service's own copy is saved; the account catches up on the next edit.
    }
}
