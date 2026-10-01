/**
 * One invite code per person.
 *
 * Every service used to hand out its own code: Food the account id, Rides a
 * USR... code, Quick its qc_users id, the Shop and Services codes of their own.
 * A person with all five apps had five codes, and a code only worked in the
 * service that made it -- Quick's and Services' invites landed on the one
 * sign-in, were read as Food codes, and credited nothing.
 *
 * Now the code is the one on the platform account (`users.referralCode`), shown
 * by every share screen, and every service's programme accepts it. Codes
 * already out in the world keep working: resolveInviter maps any of them to
 * the person they belong to.
 */
import mongoose from 'mongoose';
import { mappedCustomer } from '../identity/mergedCustomers.js';

const isHexId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const tenDigits = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const users = () => mongoose.connection.collection('users');

/** The person's invite code, made on first ask (the account id, as Food always did). */
export async function inviteCodeFor(platformUserId) {
    if (!isHexId(platformUserId)) return null;
    const _id = new mongoose.Types.ObjectId(String(platformUserId));
    const doc = await users().findOne({ _id }, { projection: { referralCode: 1 } });
    if (!doc) return null;
    if (doc.referralCode) return doc.referralCode;
    await users().updateOne(
        { _id, $or: [{ referralCode: null }, { referralCode: { $exists: false } }] },
        { $set: { referralCode: String(_id) } },
    );
    return (await users().findOne({ _id }, { projection: { referralCode: 1 } }))?.referralCode || null;
}

/** The platform account a service's customer row belongs to: its link, else its phone. */
async function platformIdOfRow(row) {
    if (!row) return null;
    if (row.platformUserId) return row.platformUserId;
    const phone = tenDigits(row.phone);
    if (phone.length !== 10) return null;
    const hit = await users().findOne(
        { phone: { $in: [phone, `+91${phone}`, `91${phone}`] } },
        { projection: { _id: 1 } },
    );
    return hit?._id || null;
}

/** Each service's own customer rows, and how its old codes were written. */
const SERVICE_ROWS = [
    { collection: 'qc_users', byId: true, byCode: true },
    { collection: 'ecom_users', byId: true, byCode: true },
    { collection: 'sp_users', byId: true, byCode: true },
];

/**
 * The platform account (its _id) any invite code names, or null. Checks the
 * platform account first (its id or referralCode), then every service's own
 * rows, for codes shared before there was one code.
 */
export async function resolveInviter(ref) {
    const code = String(ref || '').trim();
    if (!code || code.length > 64) return null;
    const codes = [...new Set([code, code.toUpperCase()])];
    const oid = isHexId(code) ? new mongoose.Types.ObjectId(code) : null;

    if (oid) {
        const byId = await users().findOne({ _id: oid }, { projection: { _id: 1 } });
        if (byId) return byId._id;
    }
    // Its own code, or a Services code (SPxxxxxx) kept on it since the sp_users merge.
    const byCode = await users().findOne(
        { $or: [{ referralCode: { $in: codes } }, { spReferralCode: { $in: codes } }] },
        { projection: { _id: 1 } },
    );
    if (byCode) return byCode._id;

    const projection = { platformUserId: 1, phone: 1 };
    for (const s of SERVICE_ROWS) {
        const or = [];
        if (s.byCode) or.push({ referralCode: { $in: codes } });
        if (s.byId && oid) or.push({ _id: oid });
        const row = await mongoose.connection.collection(s.collection).findOne({ $or: or }, { projection });
        if (row) return platformIdOfRow(row);
    }
    // A service code (its old row id) from before that service's customers were
    // merged into users, once the row is dropped (core/identity/mergedCustomers.js).
    if (oid) {
        const merged = await mappedCustomer(oid);
        if (merged?.platformId) return merged.platformId;
    }
    return null;
}

/**
 * The one code for the person behind a service's customer row (qc_users,
 * ecom_users, sp_users, or users itself), for that service's share screen.
 * Null when the row belongs to no platform account; the service then shows
 * its own code as before.
 */
export async function inviteCodeForRow(collection, rowId) {
    if (!isHexId(rowId)) return null;
    const _id = new mongoose.Types.ObjectId(String(rowId));
    if (collection === 'users') return inviteCodeFor(_id);
    const row = await mongoose.connection.collection(collection).findOne({ _id }, { projection: { platformUserId: 1, phone: 1 } });
    const platformId = await platformIdOfRow(row);
    return platformId ? inviteCodeFor(platformId) : null;
}
