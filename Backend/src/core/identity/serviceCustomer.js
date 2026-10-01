import mongoose from 'mongoose';
import { mergeLegacyAddresses } from './addressBook.js';

/**
 * A service's customers merged into the shared `users` collection.
 *
 * Quick (qc_users), the Shop (ecom_users) and Services (sp_users) each kept
 * their own customer rows linked to the platform account by platformUserId or
 * the same phone, and keyed everything by those rows' ids. After the merge the
 * service reads and writes `users`, and its customer id IS the platform id.
 * createCustomerMerge(config) builds one service's merge; quickCustomer.js,
 * shopCustomer.js and spCustomer.js are the three configurations.
 *
 * Merging one row:
 *   1. its platform account is found (platformUserId, else the same last ten
 *      digits of the phone -- the rule identityLink.service.js uses), or made
 *      with the row's own _id, so nothing keyed by that id needs to move;
 *   2. what the service needs is copied onto it, only where the account has
 *      nothing (name, email, photo ...), plus the service's own counters and
 *      flags under its own names (config.fields), which never touch another
 *      service's;
 *   3. every stored reference to the old id is rewritten to the platform id
 *      (config.refs), and the pair is kept in the id map, so an old token,
 *      invite code or link still resolves.
 *
 * Every step is idempotent, so a merge cut short is finished by running it
 * again. The service's migration script runs it for every row; until it has, a
 * customer is merged the first time they reach the service (resolveId), so the
 * code works before the script and after. Rows are never deleted here.
 */

const db = () => mongoose.connection;
const coll = (name) => db().collection(name);
export const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && /^[a-f0-9]{24}$/i.test(String(v || ''));
const toOid = (v) => new mongoose.Types.ObjectId(String(v));
const lastTen = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const empty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/** Written by a script when every row is merged: no row can be pending after it. */
export const MERGE_DONE_KEY = '__all_merged__';

/*
 * A stored reference. ObjectIds are unique across collections, so a value equal
 * to a service row's _id names that customer whatever the row's role column
 * says -- polymorphic fields are safe to rewrite by value.
 *   { c, f }            a plain field
 *   { c, arr, f }       field f of every element of array arr
 *   { c, list }         an array of ids
 *   unique: true        a unique index covers it: a clash is left and counted
 */
export function refQuery(ref, id) {
    if (ref.list) return { [ref.list]: id };
    if (ref.arr) return { [`${ref.arr}.${ref.f}`]: id };
    return { [ref.f]: id };
}

const refName = (ref) => `${ref.c}.${ref.list || (ref.arr ? `${ref.arr}.${ref.f}` : ref.f)}`;

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

export async function countRefs(refs, id) {
    const out = {};
    for (const ref of refs) {
        const n = await coll(ref.c).countDocuments(refQuery(ref, toOid(id)));
        if (n) out[refName(ref)] = n;
    }
    return out;
}

// The last ten digits, whatever is written between them ('+91 91234 56789').
export const phoneFilter = (phone) => {
    const ten = lastTen(phone);
    return ten.length === 10 ? { phone: new RegExp(`${ten.split('').join('\\D*')}\\D*$`) } : null;
};

/**
 * @param {object} config
 * @param {string} config.collection     the service's customer rows, e.g. 'ecom_users'
 * @param {string} config.mapCollection  old id -> platform id, e.g. 'ecom_user_id_map'
 * @param {Array}  config.refs           every stored reference to a row's id
 * @param {object} config.fields         the service's own names on `users`:
 *        { joinedAt, blocked, referredBy, referralCount, tokenVersion, mergedIds }
 *        (tokenVersion may be null: the service has no single-device sign-in)
 * @param {string} [config.payerModel]   payments.payerModel the service wrote
 * @param {(row) => object} [config.created]           extra fields for an account made from a row
 * @param {(row, account) => object} [config.linked]   extra $set for an existing account
 * @param {boolean} [config.copyAddresses]  false when the rows' addresses are another shape
 * @param {(row, platformId, info) => Promise} [config.afterMerge]  the service's own side of a merge
 * @param {object} [config.rowFields]    names on the row when they differ:
 *        { referredBy: 'referredBy', referralCount: 'referralCount', active: (row) => bool }
 */
export function createCustomerMerge(config) {
    const { collection, mapCollection, refs, fields, payerModel } = config;
    const row$ = {
        referredBy: (r) => r.referredBy,
        referralCount: (r) => Number(r.referralCount) || 0,
        active: (r) => r.isActive !== false,
        tokenVersion: (r) => Number(r.tokenVersion) || 0,
        ...(config.rowFields || {}),
    };

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

    async function mappedId(id) {
        if (!isId(id)) return null;
        const hit = await coll(mapCollection).findOne({ _id: toOid(id) }, { projection: { platformId: 1 } });
        return hit?.platformId ? String(hit.platformId) : null;
    }

    function accountFromRow(row, referredBy) {
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
            addresses: config.copyAddresses === false ? [] : (Array.isArray(row.addresses) ? row.addresses : []),
            isBlockedFromCOD: false,
            [fields.joinedAt]: row.createdAt || now,
            [fields.blocked]: !row$.active(row),
            [fields.referredBy]: referredBy,
            [fields.referralCount]: row$.referralCount(row),
            ...(fields.tokenVersion ? { [fields.tokenVersion]: row$.tokenVersion(row) } : {}),
            [fields.mergedIds]: [row._id],
            ...(config.created ? config.created(row) : {}),
            createdAt: row.createdAt || now,
            updatedAt: now,
        };
    }

    async function mergeFieldsInto(row, platformId, referredBy) {
        const account = await coll('users').findOne({ _id: platformId });
        if (!account) return false;
        const set = {};
        for (const f of ['name', 'email', 'profileImage', 'dateOfBirth', 'anniversary', 'gender']) {
            if (empty(account[f]) && !empty(row[f])) set[f] = row[f];
        }
        if (!account[fields.joinedAt]) set[fields.joinedAt] = row.createdAt || new Date();
        if (!row$.active(row)) set[fields.blocked] = true;
        if (row.isVerified === true && account.isVerified !== true) set.isVerified = true;
        if (!account[fields.referredBy] && referredBy) set[fields.referredBy] = referredBy;
        Object.assign(set, config.linked ? config.linked(row, account) : {});
        const tokens = (v) => (Array.isArray(v) ? v : []).filter(Boolean);
        const update = {
            $addToSet: {
                [fields.mergedIds]: row._id,
                fcmTokens: { $each: tokens(row.fcmTokens) },
                fcmTokenMobile: { $each: tokens(row.fcmTokenMobile) },
            },
            $inc: { [fields.referralCount]: row$.referralCount(row) },
            ...(fields.tokenVersion ? { $max: { [fields.tokenVersion]: row$.tokenVersion(row) } } : {}),
        };
        if (Object.keys(set).length) update.$set = set;
        // mergedIds makes this run once: the counter is added, never added twice.
        await coll('users').updateOne({ _id: platformId, [fields.mergedIds]: { $ne: row._id } }, update);
        return true;
    }

    const inflight = new Map();

    async function mergeRow(row, { dryRun = false } = {}) {
        // An id rather than the document (mongoose gives ObjectIds an `_id` getter).
        if (typeof row === 'string' || row instanceof mongoose.Types.ObjectId) {
            row = isId(row) ? await coll(collection).findOne({ _id: toOid(row) }) : null;
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
        const oldId = row._id;
        const mapped = await coll(mapCollection).findOne({ _id: oldId });
        if (mapped?.doneAt) return { oldId, platformId: mapped.platformId, action: 'already', refs: {}, clashes: 0 };

        let platformId = mapped?.platformId || (await platformAccountOf(row));
        const action = platformId && String(platformId) !== String(oldId) ? 'linked' : 'created';
        if (dryRun) {
            return { oldId, platformId: platformId || oldId, action, refs: action === 'linked' ? await countRefs(refs, oldId) : {}, clashes: 0 };
        }

        const rawReferrer = row$.referredBy(row);
        const referredBy = isId(rawReferrer) ? toOid((await mappedId(rawReferrer)) || rawReferrer) : null;

        if (!platformId) {
            try {
                await coll('users').insertOne(accountFromRow(row, referredBy));
                platformId = oldId;
            } catch (err) {
                if (err?.code !== 11000) throw err;
                // Made already (an earlier, cut-short run) or the phone raced in.
                const own = await coll('users').findOne({ _id: oldId }, { projection: { _id: 1 } });
                platformId = own?._id || (await platformAccountOf(row));
                if (!platformId) throw err;
            }
        }

        // The map first: from here an old id resolves even if the run stops.
        await coll(mapCollection).updateOne(
            { _id: oldId },
            { $set: { platformId, phone: row.phone || '', startedAt: new Date() } },
            { upsert: true },
        );

        const moved = {};
        let clashes = 0;
        if (String(platformId) !== String(oldId)) {
            await mergeFieldsInto(row, platformId, referredBy);
            if (config.copyAddresses !== false) await mergeLegacyAddresses(collection, oldId, platformId);
            for (const ref of refs) {
                const r = await rewriteRef(ref, oldId, platformId);
                if (r.moved) moved[refName(ref)] = r.moved;
                if (r.clashes) moved[`${refName(ref)} (left: clash)`] = r.clashes;
                clashes += r.clashes;
            }
            if (payerModel) {
                await coll('payments').updateMany({ payerId: platformId, payerModel }, { $set: { payerModel: 'FoodUser' } });
            }
        } else {
            // Made from the row itself: only those invited by a customer of this
            // service merged earlier and still naming the old id need fixing.
            const r = await rewriteRef({ c: 'users', f: fields.referredBy }, oldId, platformId);
            if (r.moved) moved[`users.${fields.referredBy}`] = r.moved;
            await coll(collection).updateOne({ _id: oldId }, { $set: { addressesMergedAt: new Date() } });
        }

        // What the service keeps on its own side (Services: its profile row).
        if (config.afterMerge) await config.afterMerge(row, platformId, { created: String(platformId) === String(oldId) });

        await coll(collection).updateOne(
            { _id: oldId },
            { $set: { platformUserId: platformId, mergedInto: platformId, mergedAt: new Date() } },
        );
        await coll(mapCollection).updateOne({ _id: oldId }, { $set: { doneAt: new Date(), clashes } });
        return { oldId, platformId, action, refs: moved, clashes };
    }

    let doneCache = { at: 0, done: false };
    async function allMerged() {
        if (doneCache.done || Date.now() - doneCache.at < 60 * 1000) return doneCache.done;
        const marker = await coll(mapCollection).findOne({ _id: MERGE_DONE_KEY }, { projection: { _id: 1 } });
        doneCache = { at: Date.now(), done: Boolean(marker) };
        return doneCache.done;
    }

    const clean = new Map();
    const CLEAN_TTL_MS = 10 * 60 * 1000;

    async function pendingRowsFor(platformId, phone) {
        const or = [{ platformUserId: platformId }];
        const byPhone = phoneFilter(phone);
        if (byPhone) or.push(byPhone);
        return coll(collection).find({ mergedAt: { $exists: false }, $or: or }).toArray();
    }

    /**
     * The customer id (= platform users id) for any id a client or a stored row
     * may carry: a platform id, a merged row's id (via the map), or a row not
     * merged yet -- merged now. null when the id names no customer. For a
     * platform id, the person's rows still waiting are merged first.
     */
    async function resolveId(id) {
        if (!isId(id)) return null;
        const oid = toOid(id);
        const key = String(oid);
        const hit = clean.get(key);
        if (hit && Date.now() - hit.at < CLEAN_TTL_MS) return hit.id;

        const mapped = await coll(mapCollection).findOne({ _id: oid });
        if (mapped) {
            if (!mapped.doneAt) await mergeRow(oid);
            return String(mapped.platformId);
        }

        const account = await coll('users').findOne({ _id: oid }, { projection: { phone: 1 } });
        if (account) {
            if (!(await allMerged())) {
                for (const row of await pendingRowsFor(oid, account.phone)) await mergeRow(row);
            }
            if (clean.size > 20000) clean.clear();
            clean.set(key, { id: key, at: Date.now() });
            return key;
        }

        const legacy = await coll(collection).findOne({ _id: oid });
        if (!legacy) return null;
        const merged = await mergeRow(legacy);
        return merged?.platformId ? String(merged.platformId) : null;
    }

    /**
     * The customer for a phone number (a service's own OTP sign-in): waiting
     * rows merged, then the platform account found or made (mongoose document;
     * `$locals.createdNow` when made).
     */
    async function customerForPhone(phone, { name } = {}) {
        const byPhone = phoneFilter(phone);
        const { FoodUser } = await import('../users/user.model.js');
        if (byPhone && !(await allMerged())) {
            const waiting = await coll(collection).find({ mergedAt: { $exists: false }, ...byPhone }).toArray();
            for (const row of waiting) await mergeRow(row);
        }
        const found = byPhone ? await FoodUser.findOne(byPhone) : await FoodUser.findOne({ phone });
        if (found) return found;
        const ten = lastTen(phone);
        try {
            const created = await FoodUser.create({
                phone: ten.length === 10 ? ten : String(phone),
                isVerified: true,
                [fields.joinedAt]: new Date(),
                ...(name ? { name } : {}),
            });
            created.$locals.createdNow = true;
            return created;
        } catch (err) {
            if (err?.code === 11000 && byPhone) return FoodUser.findOne(byPhone);
            throw err;
        }
    }

    /** Merge every waiting row with this phone (a service's own sign-in, before it looks the phone up). */
    async function mergeWaitingForPhone(phone) {
        const byPhone = phoneFilter(phone);
        if (!byPhone || (await allMerged())) return;
        const waiting = await coll(collection).find({ mergedAt: { $exists: false }, ...byPhone }).toArray();
        for (const row of waiting) await mergeRow(row);
    }

    /** Mark the account a customer of this service (first use). */
    async function markJoined(id) {
        if (!isId(id)) return;
        await coll('users').updateOne({ _id: toOid(id), [fields.joinedAt]: null }, { $set: { [fields.joinedAt]: new Date() } });
    }

    function clearCache() {
        clean.clear();
        doneCache = { at: 0, done: false };
    }

    return {
        collection,
        mapCollection,
        refs,
        fields,
        mergeRow,
        mappedId,
        resolveId,
        customerForPhone,
        mergeWaitingForPhone,
        markJoined,
        countRefs: (id) => countRefs(refs, id),
        clearCache,
    };
}

/**
 * A migration script's body, the same for every service: dry run (default),
 * --apply, --drop-old (refuses while any row is unmerged or any reference to a
 * moved id is left; renames the collection, never drops it).
 */
export async function runCustomerMerge(merge, { apply = false, dropOld = false, log = console.log, renameWhenIdle } = {}) {
    const db = mongoose.connection;
    const { collection, mapCollection } = merge;
    if (!(await db.db.listCollections({ name: collection }).toArray()).length) {
        log(`${collection} does not exist: nothing to merge.`);
        return { rows: 0 };
    }

    if (dropOld) {
        const unmerged = await db.collection(collection).countDocuments({ mergedAt: { $exists: false } });
        if (unmerged) {
            log(`Refusing --drop-old: ${unmerged} ${collection} rows are not merged. Run --apply first.`);
            return { refused: true, unmerged };
        }
        let leftover = 0;
        for await (const m of db.collection(mapCollection).find({ doneAt: { $exists: true } })) {
            if (String(m._id) === String(m.platformId)) continue;
            const r = await merge.countRefs(m._id);
            const n = Object.values(r).reduce((a, b) => a + b, 0);
            if (n) {
                leftover += n;
                log(`  still referenced: ${m._id}: ${JSON.stringify(r)}`);
            }
        }
        if (leftover) {
            log(`Refusing --drop-old: ${leftover} stored references still name old ${collection} ids (clashes to settle by hand).`);
            return { refused: true, leftover };
        }
        const name = `${collection}_premerge_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
        await (renameWhenIdle ? renameWhenIdle(db.collection(collection), name) : db.collection(collection).rename(name));
        log(`${collection} renamed to ${name}. Drop it by hand when sure; ${mapCollection} stays.`);
        return { renamed: name };
    }

    const totals = { rows: 0, already: 0, linked: 0, created: 0, clashes: 0, refs: {} };
    for await (const row of db.collection(collection).find({})) {
        totals.rows += 1;
        const r = await merge.mergeRow(row, { dryRun: !apply });
        if (!r) continue;
        totals[r.action] += 1;
        totals.clashes += r.clashes || 0;
        for (const [k, n] of Object.entries(r.refs || {})) totals.refs[k] = (totals.refs[k] || 0) + n;
        if (r.clashes) log(`  clash: ${r.oldId} -> ${r.platformId}: ${JSON.stringify(r.refs)}`);
    }

    if (apply) {
        const left = await db.collection(collection).countDocuments({ mergedAt: { $exists: false } });
        if (!left) {
            await db.collection(mapCollection).updateOne(
                { _id: MERGE_DONE_KEY },
                { $set: { at: new Date(), rows: totals.rows } },
                { upsert: true },
            );
        }
        totals.leftUnmerged = left;
        merge.clearCache();
    }

    log(`${apply ? 'Merged' : 'Dry run (nothing written)'}: ${totals.rows} ${collection} rows`);
    log(`  already merged ${totals.already}, ${apply ? '' : 'would be '}linked to an existing account ${totals.linked}, ${apply ? '' : 'would be '}made as a new account ${totals.created}`);
    log(`  references ${apply ? 'rewritten' : 'to rewrite'}:`);
    for (const [k, n] of Object.entries(totals.refs).sort()) log(`    ${k}: ${n}`);
    if (totals.clashes) log(`  CLASHES left on the old id: ${totals.clashes} (see lines above)`);
    if (apply) log(totals.leftUnmerged ? `  ${totals.leftUnmerged} rows still unmerged -- run again` : '  every row merged');
    return totals;
}
