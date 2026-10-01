/**
 * The Shop's (e-commerce) admins live in the shared `admins` collection.
 *
 * The Shop's merge configuration (core/admin/serviceAdmin.js has the how):
 * ecom_admins rows -> platform sub-admins of the 'ecommerce' module with
 * servicesAccess ['ecommerce'], permissions mapped from the Shop's sections
 * onto the shared resources (the ones core/admin/enforceAdminAccess guards the
 * Shop's API with, modules/ecommerce/.../admin/routes/shopAdminAccess.js). An
 * email already in `admins` keeps that account and gains the Shop (REVIEW).
 * The map is ecom_admin_id_map; scripts/migrations/mergeEcomAdmins.mjs runs it.
 */
import { createAdminMerge } from './serviceAdmin.js';

export const ECOM_ADMIN_ID_MAP = 'ecom_admin_id_map';
export const SHOP_ADMIN_SERVICES = Object.freeze(['ecommerce']);

/** The Shop's permission sections -> the shared resources. */
export const SHOP_SECTION_RESOURCES = Object.freeze({
    dashboard: ['dashboard'],
    point_of_sale: ['pos'],
    product_management: ['foods', 'categories'],
    seller_management: ['restaurants'],
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

/** Every resource the Shop's panel is guarded by (what a Shop super_admin had). */
export const SHOP_PANEL_RESOURCES = Object.freeze([
    'dashboard', 'reports', 'orders', 'customers', 'restaurants', 'foods', 'categories', 'delivery',
    'zones', 'support', 'wallet', 'fee_settings', 'promotions', 'referrals', 'cms', 'settings', 'subadmins',
]);

/* Every stored reference to a Shop admin id (audit fields, sessions, inbox). */
export const SHOP_ADMIN_REFS = Object.freeze([
    { c: 'ecom_refresh_tokens', f: 'userId' },
    { c: 'food_notifications', f: 'ownerId' },
    { c: 'ecom_notifications', f: 'ownerId' },
    { c: 'ecom_notification_broadcasts', f: 'createdBy' },
    { c: 'ecom_push_campaigns', f: 'createdBy' },
    { c: 'ecom_delivery_order_emergency_requests', f: 'resolvedBy' },
    { c: 'ecom_delivery_bonus_transactions', f: 'createdByAdminId' },
    { c: 'ecom_delivery_cash_deposits', f: 'adminId' },
    { c: 'ecom_refunds', f: 'processedBy' },
    { c: 'ecom_settlements', f: 'processedBy' },
    { c: 'ecom_dispatch_settings', f: 'updatedBy.adminId' },
    { c: 'ecom_page_contents', f: 'updatedBy' },
    { c: 'ecom_marketing_push_settings', f: 'updatedBy' },
    { c: 'ecom_first_order_guard_settings', f: 'updatedBy' },
    { c: 'ecom_cod_remittances', f: 'createdBy' },
    { c: 'ecom_subscription_transactions', f: 'processedBy.id' },
    { c: 'ecom_orders', arr: 'statusHistory', f: 'byId' },
    { c: 'ecom_order_transactions', arr: 'history', f: 'recordedBy.id' },
    { c: 'ecom_product_reviews', f: 'moderation.byId' },
    { c: 'platform_support_messages', f: 'authorId' },
]);

export const shopAdmins = createAdminMerge({
    collection: 'ecom_admins',
    mapCollection: ECOM_ADMIN_ID_MAP,
    services: SHOP_ADMIN_SERVICES,
    module: 'ecommerce',
    sectionResources: SHOP_SECTION_RESOURCES,
    panelResources: SHOP_PANEL_RESOURCES,
    refs: SHOP_ADMIN_REFS,
    typeField: 'shopAdminType',
});

export const resolveShopAdminId = (id) => shopAdmins.resolveId(id);
