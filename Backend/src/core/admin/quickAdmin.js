import mongoose from 'mongoose';
import { refQuery, rewriteRef } from '../identity/quickCustomer.js';
import { ADMIN_PERMISSION_CATALOG } from './adminAccessPolicy.js';

/**
 * Quick commerce admins live in the shared `admins` collection.
 *
 * Quick kept its own admins (`qc_admins`) with its own permission shape -- a
 * { section: [view|create|edit|delete|export] } object and an adminType of
 * super_admin / sub_admin. The platform model is servicesAccess plus
 * 'resource.read' / 'resource.write' strings, enforced for the Quick and
 * Medical panel by core/admin/enforceAdminAccess.middleware.js.
 *
 * A Quick admin becomes a platform sub-admin of the Quick module:
 *   servicesAccess ['quickCommerce', 'medical'] (one API serves both panels),
 *   module 'quickCommerce', admin_type 'subadmin' -- so the shared policy keeps
 *   them inside Quick and Medical, never Food, Rides or the Shop;
 *   a Quick super_admin gets write on every resource the Quick panel offers;
 *   a Quick sub_admin gets its sections mapped (QC_SECTION_RESOURCES), view /
 *   export as read, create / edit / delete as write, and delete access only if
 *   it had delete somewhere.
 * An email already in `admins` is the same person: that account is kept (its
 * password and permissions win) and only gains the Quick and Medical panels.
 * A new one keeps the qc_admins _id. qc_admin_id_map keeps old -> new.
 */

export const QC_ADMIN_ID_MAP = 'qc_admin_id_map';
export const QC_ADMIN_SERVICES = Object.freeze(['quickCommerce', 'medical']);

/** Quick's permission sections -> the shared resources. */
export const QC_SECTION_RESOURCES = Object.freeze({
    dashboard: ['dashboard'],
    point_of_sale: ['pos'],
    food_management: ['foods', 'categories'],
    restaurant_management: ['restaurants'],
    order_management: ['orders'],
    promotions_management: ['promotions'],
    referral_rewards: ['referrals'],
    customer_management: ['customers', 'support'],
    delivery_management: ['delivery'],
    support_management: ['support'],
    report_management: ['reports'],
    transaction_management: ['wallet'],
    banner_management: ['cms'],
    pages_social_media: ['cms'],
    sub_admin_management: ['subadmins'],
});

/** Every resource the Quick panel offers (what a Quick super_admin had). */
export const QC_PANEL_RESOURCES = Object.freeze(
    ADMIN_PERMISSION_CATALOG.flatMap((g) => g.resources)
        .filter((r) => r.services.includes('quickCommerce'))
        .map((r) => r.key),
);

const WRITE_ACTIONS = new Set(['create', 'edit', 'delete']);
const READ_ACTIONS = new Set(['view', 'export']);

/** Quick's { adminType, permissions } -> the platform's { permissions, canDelete }. */
export function qcPermissionsToPlatform({ adminType, permissions } = {}) {
    if (!adminType || adminType === 'super_admin') {
        return { permissions: QC_PANEL_RESOURCES.map((r) => `${r}.write`).concat(QC_PANEL_RESOURCES.map((r) => `${r}.read`)).sort(), canDelete: true };
    }
    const out = new Set();
    let canDelete = false;
    for (const [section, actions] of Object.entries(permissions || {})) {
        const resources = QC_SECTION_RESOURCES[section] || [];
        const list = Array.isArray(actions) ? actions.map((a) => String(a).toLowerCase()) : [];
        if (list.includes('delete')) canDelete = true;
        for (const r of resources) {
            if (list.some((a) => WRITE_ACTIONS.has(a))) out.add(`${r}.write`);
            if (list.some((a) => WRITE_ACTIONS.has(a) || READ_ACTIONS.has(a))) out.add(`${r}.read`);
        }
    }
    return { permissions: [...out].sort(), canDelete };
}

const db = () => mongoose.connection;
const coll = (name) => db().collection(name);
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const toOid = (v) => new mongoose.Types.ObjectId(String(v));

/* Every stored reference to a Quick admin id (audit fields, sessions, inbox). */
export const QC_ADMIN_REFS = Object.freeze([
    { c: 'qc_refresh_tokens', f: 'userId' },
    { c: 'food_notifications', f: 'ownerId' },
    { c: 'qc_broadcast_notifications', f: 'createdBy' },
    { c: 'qc_delivery_bonus_transactions', f: 'createdByAdminId' },
    { c: 'qc_delivery_cash_deposits', f: 'adminId' },
    { c: 'qc_delivery_order_emergency_requests', f: 'resolvedBy' },
    { c: 'qc_refunds', f: 'processedBy' },
    { c: 'qc_settlements', f: 'processedBy' },
    { c: 'qc_settingses', f: 'updatedBy.adminId' },
    { c: 'qc_subscription_transactions', f: 'processedBy.id' },
    { c: 'qc_orders', arr: 'statusHistory', f: 'byId' },
    { c: 'qc_orders', f: 'prescription.reviewedBy' },
    { c: 'qc_orders', f: 'prescription.bill.uploadedBy' },
    { c: 'qc_orders', f: 'prescription.packet.dispatchedBy' },
    { c: 'qc_transactions', arr: 'history', f: 'recordedBy.id' },
    { c: 'qc_medical_settings', f: 'updatedBy' },
    { c: 'qc_page_contents', f: 'updatedBy' },
    { c: 'qc_delivery_surge_zones', f: 'updatedBy' },
    { c: 'platform_support_messages', f: 'authorId' },
]);

const refName = (ref) => `${ref.c}.${ref.list || (ref.arr ? `${ref.arr}.${ref.f}` : ref.f)}`;

export async function countQcAdminRefs(id) {
    const out = {};
    for (const ref of QC_ADMIN_REFS) {
        const n = await coll(ref.c).countDocuments(refQuery(ref, toOid(id)));
        if (n) out[refName(ref)] = n;
    }
    return out;
}

function accountFromRow(row) {
    const { permissions, canDelete } = qcPermissionsToPlatform(row);
    const now = new Date();
    return {
        _id: row._id,
        email: String(row.email || '').toLowerCase().trim(),
        password: row.password, // already a bcrypt hash: copied, never re-hashed
        name: row.name || '',
        phone: row.phone || '',
        profileImage: row.profileImage || '',
        fcmTokens: Array.isArray(row.fcmTokens) ? row.fcmTokens : [],
        fcmTokenMobile: Array.isArray(row.fcmTokenMobile) ? row.fcmTokenMobile : [],
        role: 'ADMIN',
        isActive: row.isActive !== false && row.isDeleted !== true,
        ...(row.isDeleted === true ? { isDeleted: true } : {}),
        servicesAccess: [...QC_ADMIN_SERVICES],
        adminLevel: 'subadmin',
        module: 'quickCommerce',
        parentAdminId: null,
        admin_type: 'subadmin',
        permissions,
        canDelete,
        food_zone_ids: [],
        qc_zone_ids: [],
        service_location_ids: [],
        zone_ids: [],
        quickAdminType: row.adminType || 'super_admin',
        createdAt: row.createdAt || now,
        updatedAt: now,
    };
}

/**
 * Merge one qc_admins row into `admins`. Idempotent.
 * @returns {{ qcId, platformId, action: 'already'|'linked'|'created', refs, review? }}
 */
export async function mergeQcAdmin(row, { dryRun = false } = {}) {
    if (typeof row === 'string' || row instanceof mongoose.Types.ObjectId) {
        row = isId(row) ? await coll('qc_admins').findOne({ _id: toOid(row) }) : null;
    }
    if (!row?._id) return null;
    const qcId = row._id;
    const mapped = await coll(QC_ADMIN_ID_MAP).findOne({ _id: qcId });
    if (mapped?.doneAt) return { qcId, platformId: mapped.platformId, action: 'already', refs: {} };

    const email = String(row.email || '').toLowerCase().trim();
    const existing = mapped?.platformId
        ? { _id: mapped.platformId }
        : await coll('admins').findOne({ $or: [{ _id: qcId }, ...(email ? [{ email }] : [])] }, { projection: { _id: 1 } });
    let platformId = existing?._id || null;
    const action = platformId && String(platformId) !== String(qcId) ? 'linked' : 'created';
    if (dryRun) {
        return { qcId, platformId: platformId || qcId, action, refs: action === 'linked' ? await countQcAdminRefs(qcId) : {} };
    }

    if (!platformId) {
        try {
            await coll('admins').insertOne(accountFromRow(row));
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
        platformId = (await coll('admins').findOne({ $or: [{ _id: qcId }, { email }] }, { projection: { _id: 1 } }))?._id;
        if (!platformId) throw new Error(`could not place qc admin ${qcId}`);
    }

    await coll(QC_ADMIN_ID_MAP).updateOne(
        { _id: qcId },
        { $set: { platformId, email, startedAt: new Date() } },
        { upsert: true },
    );

    const refs = {};
    let review = false;
    if (String(platformId) !== String(qcId)) {
        // The same person already had a platform account: it keeps its password
        // and permissions and gains the Quick and Medical panels -- unless it
        // already sees every panel (an empty list) or is an owner.
        const account = await coll('admins').findOne({ _id: platformId }, { projection: { servicesAccess: 1 } });
        const services = Array.isArray(account?.servicesAccess) ? account.servicesAccess : [];
        // A Quick account that was switched off or deleted grants nothing.
        if (services.length && row.isDeleted !== true && row.isActive !== false) {
            await coll('admins').updateOne({ _id: platformId }, { $addToSet: { servicesAccess: { $each: [...QC_ADMIN_SERVICES] } } });
        }
        review = true;
        for (const ref of QC_ADMIN_REFS) {
            const r = await rewriteRef(ref, qcId, platformId);
            if (r.moved) refs[refName(ref)] = r.moved;
        }
    }
    await coll('qc_admins').updateOne({ _id: qcId }, { $set: { mergedInto: platformId, mergedAt: new Date() } });
    await coll(QC_ADMIN_ID_MAP).updateOne({ _id: qcId }, { $set: { doneAt: new Date(), review } });
    return { qcId, platformId, action, refs, review };
}

/**
 * The platform admin id for an id an admin token may carry: a platform id, a
 * merged qc_admins id (map), or a qc_admins id not merged yet -- merged now.
 * null when it names no admin.
 */
export async function resolveQuickAdminId(id) {
    if (!isId(id)) return null;
    const oid = toOid(id);
    if (await coll('admins').findOne({ _id: oid }, { projection: { _id: 1 } })) {
        // Made from a qc row with its own id: finish a cut-short merge.
        const waiting = await coll('qc_admins').findOne({ _id: oid, mergedAt: { $exists: false } });
        if (waiting) await mergeQcAdmin(waiting);
        return String(oid);
    }
    const mapped = await coll(QC_ADMIN_ID_MAP).findOne({ _id: oid });
    if (mapped) {
        if (!mapped.doneAt) await mergeQcAdmin(oid);
        return String(mapped.platformId);
    }
    const legacy = await coll('qc_admins').findOne({ _id: oid });
    if (!legacy) return null;
    const merged = await mergeQcAdmin(legacy);
    return merged?.platformId ? String(merged.platformId) : null;
}

/** Merge a qc_admins row with this email that is still waiting (Quick's admin sign-in). */
export async function mergeWaitingQcAdminByEmail(email) {
    const e = String(email || '').toLowerCase().trim();
    if (!e) return;
    const waiting = await coll('qc_admins').findOne({ email: e, mergedAt: { $exists: false } });
    if (waiting) await mergeQcAdmin(waiting);
}

/**
 * Quick's old { section: [actions] } view of a platform admin, for the panel's
 * effectivePermissions: everything for owners and module superadmins, else
 * each section from the resources it maps to.
 */
export function platformToQcPermissions(admin, { restricted, sections, actions }) {
    const full = Object.fromEntries(sections.map((s) => [s, [...actions]]));
    if (!restricted) return full;
    const perms = new Set(Array.isArray(admin?.permissions) ? admin.permissions : []);
    if (perms.has('*')) return full;
    const out = {};
    for (const s of sections) {
        const resources = QC_SECTION_RESOURCES[s] || [];
        const write = resources.length && resources.every((r) => perms.has(`${r}.write`));
        const read = write || (resources.length && resources.every((r) => perms.has(`${r}.read`) || perms.has(`${r}.write`)));
        out[s] = write
            ? ['view', 'create', 'edit', 'export', ...(admin?.canDelete !== false ? ['delete'] : [])]
            : read ? ['view', 'export'] : [];
    }
    return out;
}
