import { createAdminMerge } from './serviceAdmin.js';
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
    { c: 'refunds', f: 'processedBy' },
    { c: 'settlements', f: 'processedBy' },
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

export const quickAdmins = createAdminMerge({
    collection: 'qc_admins',
    mapCollection: QC_ADMIN_ID_MAP,
    services: QC_ADMIN_SERVICES,
    module: 'quickCommerce',
    sectionResources: QC_SECTION_RESOURCES,
    panelResources: QC_PANEL_RESOURCES,
    refs: QC_ADMIN_REFS,
    typeField: 'quickAdminType',
});

export const qcPermissionsToPlatform = (row) => quickAdmins.toPlatformPermissions(row);
export const countQcAdminRefs = (id) => quickAdmins.countRefs(id);
export const mergeQcAdmin = (row, options) => quickAdmins.mergeRow(row, options);
export const resolveQuickAdminId = (id) => quickAdmins.resolveId(id);
export const mergeWaitingQcAdminByEmail = (email) => quickAdmins.mergeWaitingByEmail(email);
export const platformToQcPermissions = (admin, options) => quickAdmins.toSectionPermissions(admin, options);
