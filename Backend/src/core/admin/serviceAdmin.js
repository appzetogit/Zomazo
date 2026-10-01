import mongoose from 'mongoose';
import { countRefs, rewriteRef } from '../identity/serviceCustomer.js';

/**
 * A service's own admins merged into the shared `admins` collection.
 *
 * Quick (qc_admins) and the Shop (ecom_admins) kept their own admins with
 * their own permission shape -- a { section: [view|create|edit|delete|export] }
 * object and an adminType of super_admin / sub_admin. The platform model is
 * servicesAccess plus 'resource.read' / 'resource.write' strings, enforced per
 * panel by core/admin/enforceAdminAccess.middleware.js.
 * createAdminMerge(config) builds one service's merge; quickAdmin.js and
 * shopAdmin.js are the configurations.
 *
 * A service admin becomes a platform sub-admin of that service's module
 * (servicesAccess config.services, module config.module, admin_type
 * 'subadmin', so the shared policy keeps them inside that service):
 *   a super_admin gets write on every resource the service's panel offers;
 *   a sub_admin gets its sections mapped (config.sectionResources), view /
 *   export as read, create / edit / delete as write, and delete access only if
 *   it had delete somewhere.
 * An email already in `admins` is the same person: that account is kept (its
 * password and permissions win) and only gains the service's panels; the
 * script lists these for review. A new one keeps the row's _id and its
 * password hash. The id map keeps old -> new.
 */

const db = () => mongoose.connection;
const coll = (name) => db().collection(name);
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const toOid = (v) => new mongoose.Types.ObjectId(String(v));
const refName = (ref) => `${ref.c}.${ref.list || (ref.arr ? `${ref.arr}.${ref.f}` : ref.f)}`;

const WRITE_ACTIONS = new Set(['create', 'edit', 'delete']);
const READ_ACTIONS = new Set(['view', 'export']);

/**
 * @param {object} config
 * @param {string}   config.collection        e.g. 'ecom_admins'
 * @param {string}   config.mapCollection     e.g. 'ecom_admin_id_map'
 * @param {string[]} config.services          servicesAccess given, e.g. ['ecommerce']
 * @param {string}   config.module            platform admin module, e.g. 'ecommerce'
 * @param {object}   config.sectionResources  the service's section -> shared resources
 * @param {string[]} config.panelResources    every resource the service's panel offers
 * @param {Array}    config.refs              stored references to an admin id
 * @param {string}   [config.typeField]       where the old adminType is kept on the account
 */
export function createAdminMerge(config) {
    const { collection, mapCollection, services, module, sectionResources, panelResources, refs } = config;

    /** The service's { adminType, permissions } -> the platform's { permissions, canDelete }. */
    function toPlatformPermissions({ adminType, permissions } = {}) {
        if (!adminType || adminType === 'super_admin') {
            return { permissions: panelResources.flatMap((r) => [`${r}.read`, `${r}.write`]).sort(), canDelete: true };
        }
        const out = new Set();
        let canDelete = false;
        for (const [section, actions] of Object.entries(permissions || {})) {
            const resources = sectionResources[section] || [];
            const list = Array.isArray(actions) ? actions.map((a) => String(a).toLowerCase()) : [];
            if (list.includes('delete')) canDelete = true;
            for (const r of resources) {
                if (list.some((a) => WRITE_ACTIONS.has(a))) out.add(`${r}.write`);
                if (list.some((a) => WRITE_ACTIONS.has(a) || READ_ACTIONS.has(a))) out.add(`${r}.read`);
            }
        }
        return { permissions: [...out].sort(), canDelete };
    }

    /**
     * The service's old { section: [actions] } view of a platform admin, for its
     * panel: everything for owners and module superadmins (restricted false),
     * else each section from the resources it maps to.
     */
    function toSectionPermissions(admin, { restricted, sections, actions }) {
        const full = Object.fromEntries(sections.map((s) => [s, [...actions]]));
        if (!restricted) return full;
        const perms = new Set(Array.isArray(admin?.permissions) ? admin.permissions : []);
        if (perms.has('*')) return full;
        const out = {};
        for (const s of sections) {
            const resources = sectionResources[s] || [];
            const write = resources.length && resources.every((r) => perms.has(`${r}.write`));
            const read = write || (resources.length && resources.every((r) => perms.has(`${r}.read`) || perms.has(`${r}.write`)));
            out[s] = write
                ? ['view', 'create', 'edit', 'export', ...(admin?.canDelete !== false ? ['delete'] : [])]
                : read ? ['view', 'export'] : [];
        }
        return out;
    }

    /** A new platform sub-admin of this service, as a raw document (password: a bcrypt hash). */
    function newAccount({ _id, email, password, name, phone, adminType, permissions, isActive = true, isDeleted = false, createdAt, extra = {} }) {
        const mapped = toPlatformPermissions({ adminType, permissions });
        const now = new Date();
        return {
            _id: _id || new mongoose.Types.ObjectId(),
            email: String(email || '').toLowerCase().trim(),
            password,
            name: name || '',
            phone: phone || '',
            profileImage: '',
            fcmTokens: [],
            fcmTokenMobile: [],
            role: 'ADMIN',
            isActive: isActive !== false && isDeleted !== true,
            ...(isDeleted === true ? { isDeleted: true } : {}),
            servicesAccess: [...services],
            adminLevel: 'subadmin',
            module,
            parentAdminId: null,
            admin_type: 'subadmin',
            permissions: mapped.permissions,
            canDelete: mapped.canDelete,
            food_zone_ids: [],
            qc_zone_ids: [],
            service_location_ids: [],
            zone_ids: [],
            ...(config.typeField ? { [config.typeField]: adminType || 'super_admin' } : {}),
            ...extra,
            createdAt: createdAt || now,
            updatedAt: now,
        };
    }

    function accountFromRow(row) {
        return {
            ...newAccount({
                _id: row._id,
                email: row.email,
                password: row.password, // already a bcrypt hash: copied, never re-hashed
                name: row.name,
                phone: row.phone,
                adminType: row.adminType,
                permissions: row.permissions,
                isActive: row.isActive,
                isDeleted: row.isDeleted,
                createdAt: row.createdAt,
            }),
            profileImage: row.profileImage || '',
            fcmTokens: Array.isArray(row.fcmTokens) ? row.fcmTokens : [],
            fcmTokenMobile: Array.isArray(row.fcmTokenMobile) ? row.fcmTokenMobile : [],
        };
    }

    async function mergeRow(row, { dryRun = false } = {}) {
        if (typeof row === 'string' || row instanceof mongoose.Types.ObjectId) {
            row = isId(row) ? await coll(collection).findOne({ _id: toOid(row) }) : null;
        }
        if (!row?._id) return null;
        const oldId = row._id;
        const mapped = await coll(mapCollection).findOne({ _id: oldId });
        if (mapped?.doneAt) return { oldId, platformId: mapped.platformId, action: 'already', refs: {} };

        const email = String(row.email || '').toLowerCase().trim();
        const existing = mapped?.platformId
            ? { _id: mapped.platformId }
            : await coll('admins').findOne({ $or: [{ _id: oldId }, ...(email ? [{ email }] : [])] }, { projection: { _id: 1 } });
        let platformId = existing?._id || null;
        const action = platformId && String(platformId) !== String(oldId) ? 'linked' : 'created';
        if (dryRun) {
            return { oldId, platformId: platformId || oldId, action, refs: action === 'linked' ? await countRefs(refs, oldId) : {} };
        }

        if (!platformId) {
            try {
                await coll('admins').insertOne(accountFromRow(row));
            } catch (err) {
                if (err?.code !== 11000) throw err;
            }
            platformId = (await coll('admins').findOne({ $or: [{ _id: oldId }, { email }] }, { projection: { _id: 1 } }))?._id;
            if (!platformId) throw new Error(`could not place ${collection} admin ${oldId}`);
        }

        await coll(mapCollection).updateOne(
            { _id: oldId },
            { $set: { platformId, email, startedAt: new Date() } },
            { upsert: true },
        );

        const moved = {};
        let review = false;
        if (String(platformId) !== String(oldId)) {
            // The same person already had a platform account: it keeps its
            // password and permissions and gains this service's panels -- unless
            // it already sees every panel (an empty list). A service account
            // that was switched off or deleted grants nothing.
            const account = await coll('admins').findOne({ _id: platformId }, { projection: { servicesAccess: 1 } });
            const listed = Array.isArray(account?.servicesAccess) ? account.servicesAccess : [];
            if (listed.length && row.isDeleted !== true && row.isActive !== false) {
                await coll('admins').updateOne({ _id: platformId }, { $addToSet: { servicesAccess: { $each: [...services] } } });
            }
            review = true;
            for (const ref of refs) {
                const r = await rewriteRef(ref, oldId, platformId);
                if (r.moved) moved[refName(ref)] = r.moved;
            }
        }
        await coll(collection).updateOne({ _id: oldId }, { $set: { mergedInto: platformId, mergedAt: new Date() } });
        await coll(mapCollection).updateOne({ _id: oldId }, { $set: { doneAt: new Date(), review } });
        return { oldId, platformId, action, refs: moved, review };
    }

    /**
     * The platform admin id for an id an admin token may carry: a platform id,
     * a merged row's id (map), or a row not merged yet -- merged now. null when
     * it names no admin.
     */
    async function resolveId(id) {
        if (!isId(id)) return null;
        const oid = toOid(id);
        if (await coll('admins').findOne({ _id: oid }, { projection: { _id: 1 } })) {
            // Made from a row with its own id: finish a cut-short merge.
            const waiting = await coll(collection).findOne({ _id: oid, mergedAt: { $exists: false } });
            if (waiting) await mergeRow(waiting);
            return String(oid);
        }
        const mapped = await coll(mapCollection).findOne({ _id: oid });
        if (mapped) {
            if (!mapped.doneAt) await mergeRow(oid);
            return String(mapped.platformId);
        }
        const legacy = await coll(collection).findOne({ _id: oid });
        if (!legacy) return null;
        const merged = await mergeRow(legacy);
        return merged?.platformId ? String(merged.platformId) : null;
    }

    /** Merge a row with this email that is still waiting (the service's admin sign-in). */
    async function mergeWaitingByEmail(email) {
        const e = String(email || '').toLowerCase().trim();
        if (!e) return;
        const waiting = await coll(collection).findOne({ email: e, mergedAt: { $exists: false } });
        if (waiting) await mergeRow(waiting);
    }

    return {
        collection,
        mapCollection,
        refs,
        mergeRow,
        resolveId,
        mergeWaitingByEmail,
        toPlatformPermissions,
        toSectionPermissions,
        newAccount,
        countRefs: (id) => countRefs(refs, id),
    };
}

/** A migration script's body: dry run (default), --apply, --drop-old. */
export async function runAdminMerge(merge, { apply = false, dropOld = false, log = console.log, renameWhenIdle } = {}) {
    const conn = mongoose.connection;
    const { collection, mapCollection } = merge;
    if (!(await conn.db.listCollections({ name: collection }).toArray()).length) {
        log(`${collection} does not exist: nothing to merge.`);
        return { rows: 0 };
    }

    if (dropOld) {
        const unmerged = await conn.collection(collection).countDocuments({ mergedAt: { $exists: false } });
        if (unmerged) {
            log(`Refusing --drop-old: ${unmerged} ${collection} rows are not merged. Run --apply first.`);
            return { refused: true, unmerged };
        }
        let leftover = 0;
        for await (const m of conn.collection(mapCollection).find({ doneAt: { $exists: true } })) {
            if (String(m._id) === String(m.platformId)) continue;
            leftover += Object.values(await merge.countRefs(m._id)).reduce((a, b) => a + b, 0);
        }
        if (leftover) {
            log(`Refusing --drop-old: ${leftover} stored references still name old ${collection} ids.`);
            return { refused: true, leftover };
        }
        const name = `${collection}_premerge_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
        await (renameWhenIdle ? renameWhenIdle(conn.collection(collection), name) : conn.collection(collection).rename(name));
        log(`${collection} renamed to ${name}. Drop it by hand when sure; ${mapCollection} stays.`);
        return { renamed: name };
    }

    const totals = { rows: 0, already: 0, linked: 0, created: 0, review: [], refs: {} };
    for await (const row of conn.collection(collection).find({})) {
        totals.rows += 1;
        const r = await merge.mergeRow(row, { dryRun: !apply });
        if (!r) continue;
        totals[r.action] += 1;
        if (r.action === 'linked') totals.review.push(row.email);
        for (const [k, n] of Object.entries(r.refs || {})) totals.refs[k] = (totals.refs[k] || 0) + n;
    }
    if (apply) totals.leftUnmerged = await conn.collection(collection).countDocuments({ mergedAt: { $exists: false } });

    log(`${apply ? 'Merged' : 'Dry run (nothing written)'}: ${totals.rows} ${collection} rows`);
    log(`  already merged ${totals.already}, ${apply ? '' : 'would be '}linked by email ${totals.linked}, ${apply ? '' : 'would be '}made ${totals.created}`);
    for (const [k, n] of Object.entries(totals.refs).sort()) log(`    ${k}: ${n}`);
    if (totals.review.length) log(`  REVIEW (kept their platform permissions, gained ${merge.collection}'s panels): ${totals.review.join(', ')}`);
    if (apply) log(totals.leftUnmerged ? `  ${totals.leftUnmerged} rows still unmerged -- run again` : '  every row merged');
    return totals;
}
