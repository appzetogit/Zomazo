import mongoose from 'mongoose';
import { mergeLegacyAddresses } from './addressBook.js';

/**
 * Quick commerce customers live in the shared `users` collection.
 *
 * Until the merge, Quick kept its own customer rows (`qc_users`) linked to the
 * platform account by platformUserId or the same phone, and every Quick
 * collection was keyed by the qc_users _id. Now Quick reads and writes `users`
 * directly, and its customer id IS the platform id.
 *
 * Merging one qc_users row:
 *   1. its platform account is found (platformUserId, else the same last ten
 *      digits of the phone -- the rule identityLink.service.js uses), or made
 *      with the qc row's own _id, so nothing keyed by that id needs to move;
 *   2. what Quick needs is copied onto it, only where the account has nothing
 *      (name, email, photo ...), plus Quick's own counters and flags under
 *      their own names (quickReferralCount, quickBlocked, quickReferredBy);
 *   3. every stored reference to the old id is rewritten to the platform id
 *      (QC_USER_REFS), and the pair is kept in `qc_user_id_map` so an old
 *      token, invite code or link still resolves.
 *
 * Every step is idempotent, so a merge cut short is finished by running it
 * again. scripts/migrations/mergeQcUsers.mjs runs it for every row; until that
 * has run, a customer is merged the first time they reach Quick
 * (resolveQuickCustomerId), so the code works before the script and after.
 * qc_users rows are never deleted here (the script's --drop-old does, later).
 */

export const QC_USER_ID_MAP = 'qc_user_id_map';
/** Written by the script when every row is merged: no row can be pending after it. */
export const QC_MERGE_DONE_KEY = '__all_merged__';

const db = () => mongoose.connection;
const coll = (name) => db().collection(name);
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && /^[a-f0-9]{24}$/i.test(String(v || ''));
const toOid = (v) => new mongoose.Types.ObjectId(String(v));
const lastTen = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const empty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/*
 * Every stored reference to a Quick customer's id. ObjectIds are unique across
 * collections, so a value equal to a qc_users _id names that customer whatever
 * the row's role column says -- polymorphic fields (chat sender, entity,
 * refresh-token owner) are safe to rewrite by value.
 *
 *   { c, f }            a plain field
 *   { c, arr, f }       field f of every element of array arr
 *   { c, list }         an array of ids
 *   unique: true        a unique index covers it: a clash is left and counted
 */
export const QC_USER_REFS = Object.freeze([
    { c: 'qc_orders', f: 'userId' },
    { c: 'qc_orders', arr: 'statusHistory', f: 'byId' },
    { c: 'qc_prescription_requests', f: 'userId' },
    { c: 'qc_referral_logs', f: 'referrerId' },
    { c: 'qc_referral_logs', f: 'refereeId' },
    { c: 'qc_refresh_tokens', f: 'userId' },
    { c: 'qc_refunds', f: 'userId' },
    { c: 'qc_returns', f: 'userId' },
    { c: 'qc_safety_emergency_reports', f: 'userId' },
    { c: 'qc_support_tickets', f: 'userId' },
    { c: 'qc_transactions', f: 'userId' },
    { c: 'qc_transactions', arr: 'history', f: 'recordedBy.id' },
    { c: 'qc_user_carts', f: 'userId', unique: true },
    { c: 'qc_user_favorites', f: 'userId', unique: true },
    { c: 'qc_feedback_experiences', f: 'userId' },
    { c: 'qc_chat_messages', f: 'senderId' },
    { c: 'qc_chat_messages', f: 'recipientId' },
    { c: 'qc_broadcast_notifications', list: 'targetIds' },
    { c: 'qc_broadcast_notifications', arr: 'targets', f: 'ownerId' },
    { c: 'qc_entity_transactions', f: 'entityId' },
    { c: 'qc_settlements', f: 'entityId' },
    // Shared collections Quick writes with its own ids.
    { c: 'food_offer_usages', f: 'userId' },
    { c: 'food_notifications', f: 'ownerId' },
    { c: 'payments', f: 'payerId' },
    { c: 'food_user_wallets', f: 'userId', unique: true },
    { c: 'platform_referral_claims', f: 'referrerId' },
    { c: 'platform_referral_claims', f: 'refereeId' },
    { c: 'platform_support_messages', f: 'authorId' },
    { c: 'platform_loyalty_accounts', f: 'platformUserId', unique: true },
    { c: 'platform_loyalty_ledger', f: 'platformUserId' },
    { c: 'platform_coupon_uses', f: 'platformUserId', unique: true },
    { c: 'platform_cashback_offer_uses', f: 'platformUserId', unique: true },
    { c: 'users', f: 'quickReferredBy' },
]);

export function refQuery(ref, id) {
    if (ref.list) return { [ref.list]: id };
    if (ref.arr) return { [`${ref.arr}.${ref.f}`]: id };
    return { [ref.f]: id };
}

function refUpdate(ref, from, to) {
    if (ref.list) return [{ $set: { [`${ref.list}.$[e]`]: to } }, { arrayFilters: [{ e: from }] }];
    if (ref.arr) return [{ $set: { [`${ref.arr}.$[e].${ref.f}`]: to } }, { arrayFilters: [{ [`e.${ref.f}`]: from }] }];
    return [{ $set: { [ref.f]: to } }, {}];
}

export async function rewriteRef(ref, from, to) {
    const q = refQuery(ref, from);
    const [update, options] = refUpdate(ref, from, to);
    try {
        const r = await coll(ref.c).updateMany(q, update, options);
        return { moved: r.modifiedCount, clashes: 0 };
    } catch (err) {
        if (err?.code !== 11000) throw err;
    }
    // A unique index already has a row for the platform id (a wallet, a cart).
    // Each row is moved alone; the clashing ones stay on the old id, counted.
    let moved = 0;
    let clashes = 0;
    for (const doc of await coll(ref.c).find(q, { projection: { _id: 1 } }).toArray()) {
        try {
            const r = await coll(ref.c).updateOne({ _id: doc._id, ...q }, update, options);
            moved += r.modifiedCount;
        } catch (err) {
            if (err?.code !== 11000) throw err;
            clashes += 1;
        }
    }
    return { moved, clashes };
}

/** How many stored references each QC_USER_REFS entry has to an id (dry run). */
export async function countQcUserRefs(id) {
    const out = {};
    for (const ref of QC_USER_REFS) {
        const n = await coll(ref.c).countDocuments(refQuery(ref, toOid(id)));
        if (n) out[`${ref.c}.${ref.list || (ref.arr ? `${ref.arr}.${ref.f}` : ref.f)}`] = n;
    }
    return out;
}

// The last ten digits, whatever is written between them ('+91 91234 56789').
const phoneFilter = (phone) => {
    const ten = lastTen(phone);
    return ten.length === 10 ? { phone: new RegExp(`${ten.split('').join('\\D*')}\\D*$`) } : null;
};

/** The platform account a qc_users row belongs to, or null when it has none. */
async function platformAccountOf(row) {
    if (isId(row.platformUserId)) {
        const linked = await coll('users').findOne({ _id: toOid(row.platformUserId) }, { projection: { _id: 1 } });
        if (linked) return linked._id;
    }
    const byPhone = phoneFilter(row.phone);
    if (!byPhone) return null;
    const hit = await coll('users').findOne(byPhone, { projection: { _id: 1 } });
    return hit?._id || null;
}

/** The platform id an old Quick id was merged into (map, else the row's stamp). */
export async function mappedQuickId(id) {
    if (!isId(id)) return null;
    const hit = await coll(QC_USER_ID_MAP).findOne({ _id: toOid(id) }, { projection: { platformId: 1 } });
    return hit?.platformId ? String(hit.platformId) : null;
}

async function accountFromRow(row, referredBy) {
    const ten = lastTen(row.phone);
    const now = new Date();
    return {
        _id: row._id,
        phone: ten.length === 10 ? ten : String(row.phone || ''),
        countryCode: row.countryCode || '+91',
        ...(row.name ? { name: row.name } : {}),
        ...(row.email ? { email: row.email } : {}),
        profileImage: row.profileImage || '',
        fcmTokens: Array.isArray(row.fcmTokens) ? row.fcmTokens : [],
        fcmTokenMobile: Array.isArray(row.fcmTokenMobile) ? row.fcmTokenMobile : [],
        dateOfBirth: row.dateOfBirth || null,
        anniversary: row.anniversary || null,
        gender: row.gender || '',
        referralCode: row.referralCode || String(row._id),
        referredBy: null,
        referralCount: 0,
        isVerified: row.isVerified === true,
        isActive: true,
        role: 'USER',
        addresses: Array.isArray(row.addresses) ? row.addresses : [],
        isBlockedFromCOD: false,
        quickJoinedAt: row.createdAt || now,
        quickBlocked: row.isActive === false,
        quickReferredBy: referredBy,
        quickReferralCount: Number(row.referralCount) || 0,
        rating: Number(row.rating) || 0,
        totalRatings: Number(row.totalRatings) || 0,
        tokenVersion: Number(row.tokenVersion) || 0,
        mergedQcIds: [row._id],
        createdAt: row.createdAt || now,
        updatedAt: now,
    };
}

/** Quick's fields onto an existing platform account -- once per qc row, atomically. */
async function mergeFieldsInto(row, platformId, referredBy) {
    const account = await coll('users').findOne({ _id: platformId });
    if (!account) return false;
    const set = {};
    for (const f of ['name', 'email', 'profileImage', 'dateOfBirth', 'anniversary', 'gender']) {
        if (empty(account[f]) && !empty(row[f])) set[f] = row[f];
    }
    if (!account.quickJoinedAt) set.quickJoinedAt = row.createdAt || new Date();
    if (row.isActive === false) set.quickBlocked = true;
    if (row.isVerified === true && account.isVerified !== true) set.isVerified = true;
    if (!account.quickReferredBy && referredBy) set.quickReferredBy = referredBy;
    if (!(Number(account.totalRatings) > 0) && Number(row.totalRatings) > 0) {
        set.rating = Number(row.rating) || 0;
        set.totalRatings = Number(row.totalRatings);
    }
    const tokens = (v) => (Array.isArray(v) ? v : []).filter(Boolean);
    const update = {
        $addToSet: {
            mergedQcIds: row._id,
            fcmTokens: { $each: tokens(row.fcmTokens) },
            fcmTokenMobile: { $each: tokens(row.fcmTokenMobile) },
        },
        $inc: { quickReferralCount: Number(row.referralCount) || 0 },
        $max: { tokenVersion: Number(row.tokenVersion) || 0 },
    };
    if (Object.keys(set).length) update.$set = set;
    // mergedQcIds makes this run once: the counter is added, never added twice.
    await coll('users').updateOne({ _id: platformId, mergedQcIds: { $ne: row._id } }, update);
    return true;
}

const inflight = new Map();

/**
 * Merge one qc_users row into the shared users collection. Idempotent.
 *
 * @param {object} row  the qc_users document (or its _id)
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{ qcId, platformId, action, refs, clashes }>}
 *   action: 'already' | 'linked' | 'created'; refs: counts per reference
 */
export async function mergeQcUser(row, { dryRun = false } = {}) {
    // An id rather than the document (mongoose gives ObjectIds an `_id` getter).
    if (typeof row === 'string' || row instanceof mongoose.Types.ObjectId) {
        row = isId(row) ? await coll('qc_users').findOne({ _id: toOid(row) }) : null;
    }
    if (!row?._id) return null;
    const key = String(row._id);
    if (!dryRun && inflight.has(key)) return inflight.get(key);
    const run = mergeOne(row, dryRun);
    if (dryRun) return run;
    inflight.set(key, run);
    try {
        return await run;
    } finally {
        inflight.delete(key);
    }
}

async function mergeOne(row, dryRun) {
    const qcId = row._id;
    const mapped = await coll(QC_USER_ID_MAP).findOne({ _id: qcId });
    if (mapped?.doneAt) return { qcId, platformId: mapped.platformId, action: 'already', refs: {}, clashes: 0 };

    let platformId = mapped?.platformId || (await platformAccountOf(row));
    const action = platformId && String(platformId) !== String(qcId) ? 'linked' : 'created';
    if (dryRun) {
        return { qcId, platformId: platformId || qcId, action, refs: action === 'linked' ? await countQcUserRefs(qcId) : {}, clashes: 0 };
    }

    const referredBy = isId(row.referredBy)
        ? toOid((await mappedQuickId(row.referredBy)) || row.referredBy)
        : null;

    if (!platformId) {
        try {
            await coll('users').insertOne(await accountFromRow(row, referredBy));
            platformId = qcId;
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // Made already (an earlier, cut-short run) or the phone raced in.
            const own = await coll('users').findOne({ _id: qcId }, { projection: { _id: 1 } });
            platformId = own?._id || (await platformAccountOf(row));
            if (!platformId) throw err;
        }
    }

    // The map first: from here an old id resolves even if the run stops.
    await coll(QC_USER_ID_MAP).updateOne(
        { _id: qcId },
        { $set: { platformId, phone: row.phone || '', startedAt: new Date() } },
        { upsert: true },
    );

    const refs = {};
    let clashes = 0;
    if (String(platformId) !== String(qcId)) {
        await mergeFieldsInto(row, platformId, referredBy);
        await mergeLegacyAddresses('qc_users', qcId, platformId);
        for (const ref of QC_USER_REFS) {
            const r = await rewriteRef(ref, qcId, platformId);
            const name = `${ref.c}.${ref.list || (ref.arr ? `${ref.arr}.${ref.f}` : ref.f)}`;
            if (r.moved) refs[name] = r.moved;
            if (r.clashes) refs[`${name} (left: clash)`] = r.clashes;
            clashes += r.clashes;
        }
        await coll('payments').updateMany({ payerId: platformId, payerModel: 'QCUser' }, { $set: { payerModel: 'FoodUser' } });
    } else {
        // Made from the row itself: only those who were invited by a Quick
        // customer merged earlier and still name the old id need fixing.
        const r = await rewriteRef({ c: 'users', f: 'quickReferredBy' }, qcId, platformId);
        if (r.moved) refs['users.quickReferredBy'] = r.moved;
        await coll('qc_users').updateOne({ _id: qcId }, { $set: { addressesMergedAt: new Date() } });
    }

    await coll('qc_users').updateOne(
        { _id: qcId },
        { $set: { platformUserId: platformId, mergedInto: platformId, mergedAt: new Date() } },
    );
    await coll(QC_USER_ID_MAP).updateOne({ _id: qcId }, { $set: { doneAt: new Date(), clashes } });
    return { qcId, platformId, action, refs, clashes };
}

let doneCache = { at: 0, done: false };
async function allMerged() {
    if (doneCache.done || Date.now() - doneCache.at < 60 * 1000) return doneCache.done;
    const marker = await coll(QC_USER_ID_MAP).findOne({ _id: QC_MERGE_DONE_KEY }, { projection: { _id: 1 } });
    doneCache = { at: Date.now(), done: Boolean(marker) };
    return doneCache.done;
}

const clean = new Map();
const CLEAN_TTL_MS = 10 * 60 * 1000;

/** qc_users rows of this platform account not merged yet (link or same phone). */
async function pendingRowsFor(platformId, phone) {
    const or = [{ platformUserId: platformId }];
    const byPhone = phoneFilter(phone);
    if (byPhone) or.push(byPhone);
    return coll('qc_users').find({ mergedAt: { $exists: false }, $or: or }).toArray();
}

/**
 * The Quick customer id (= platform users id) for any id a client or a stored
 * row may carry: a platform id, a merged qc_users id (via the map), or a
 * qc_users id not merged yet -- which is merged now. null when the id names
 * no customer.
 *
 * For a platform id, any of the person's qc_users rows still waiting are
 * merged first, so their orders and cart are there on this very request.
 */
export async function resolveQuickCustomerId(id) {
    if (!isId(id)) return null;
    const oid = toOid(id);
    const key = String(oid);
    const hit = clean.get(key);
    if (hit && Date.now() - hit.at < CLEAN_TTL_MS) return hit.id;

    const mapped = await coll(QC_USER_ID_MAP).findOne({ _id: oid });
    if (mapped) {
        if (!mapped.doneAt) await mergeQcUser(oid);
        return String(mapped.platformId);
    }

    const account = await coll('users').findOne({ _id: oid }, { projection: { phone: 1 } });
    if (account) {
        if (!(await allMerged())) {
            for (const row of await pendingRowsFor(oid, account.phone)) await mergeQcUser(row);
        }
        if (clean.size > 20000) clean.clear();
        clean.set(key, { id: key, at: Date.now() });
        return key;
    }

    const legacy = await coll('qc_users').findOne({ _id: oid });
    if (!legacy) return null;
    const merged = await mergeQcUser(legacy);
    return merged?.platformId ? String(merged.platformId) : null;
}

/**
 * The Quick customer for a phone number (Quick's own OTP sign-in): its
 * waiting qc_users rows merged, then the platform account found or made.
 * Returns the mongoose document of the platform account.
 */
export async function quickCustomerForPhone(phone, { name } = {}) {
    const byPhone = phoneFilter(phone);
    const { FoodUser } = await import('../users/user.model.js');
    if (byPhone && !(await allMerged())) {
        const waiting = await coll('qc_users').find({ mergedAt: { $exists: false }, ...byPhone }).toArray();
        for (const row of waiting) await mergeQcUser(row);
    }
    const found = byPhone ? await FoodUser.findOne(byPhone) : await FoodUser.findOne({ phone });
    if (found) return found;
    const ten = lastTen(phone);
    try {
        const created = await FoodUser.create({
            phone: ten.length === 10 ? ten : String(phone),
            isVerified: true,
            quickJoinedAt: new Date(),
            ...(name ? { name } : {}),
        });
        created.$locals.createdNow = true;
        return created;
    } catch (err) {
        if (err?.code === 11000 && byPhone) return FoodUser.findOne(byPhone);
        throw err;
    }
}

/** Forget cached answers (tests). */
export function clearQuickCustomerCache() {
    clean.clear();
    doneCache = { at: 0, done: false };
}
