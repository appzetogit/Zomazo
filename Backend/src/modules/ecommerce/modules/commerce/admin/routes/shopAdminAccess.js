import { OPEN } from '../../../../../../core/admin/adminAccessPolicy.js';

/*
 * The Shop admin API mapped onto the shared admin resources (core/admin/
 * adminAccessPolicy.js), so a platform sub-admin given the Shop gets only the
 * sections they were given. Without it every platform admin let into the Shop
 * was bridged to a Shop superadmin (core/roles/adminPermission.middleware.js).
 *
 * Paths are relative to the Shop admin router. First match wins. An unmapped
 * write is refused to sub-admins, so a new route stays closed until mapped.
 */
const rule = (pattern, resource, methods = null) => ({ pattern, resource, methods });

const SHOP_ADMIN_RULES = [
  // Lookups screens make to fill a filter or a header.
  rule(/^\/(sidebar-badges|global-search|notifications\/fssai-expired|sub-admins\/permission-catalog)(\/|$)/, OPEN, ['GET']),
  rule(/^\/(zones|categories|attributes|attribute-sets|business-settings|feature-settings|power-scanning|fee-settings)(\/|$)/, OPEN, ['GET']),
  rule(/^\/sellers\/?$/, OPEN, ['GET']),

  rule(/^\/sub-admins(\/|$)/, 'subadmins'),
  rule(/^\/(dashboard-stats|analytics)(\/|$)/, 'dashboard'),

  rule(/^\/sellers\/complaints(\/|$)/, 'support'),
  rule(/^\/(support-tickets|safety-emergency-reports|contact-messages|delivery\/support-tickets)(\/|$)/, 'support'),

  rule(/^\/(reports|feedback-experiences|cod-remittances)(\/|$)/, 'reports'),
  rule(/^\/(withdrawals|delivery\/withdrawals|delivery\/wallets|coins)(\/|$)/, 'wallet'),

  rule(/^\/(sellers|seller-settings|seller-subscription-settings|seller-subscriptions|seller-commissions|zones)(\/|$)/, 'restaurants'),
  rule(/^\/categories(\/|$)/, 'categories'),
  rule(/^\/(products|attributes|attribute-sets|inventory|product-reviews)(\/|$)/, 'foods'),
  rule(/^\/(orders|order-detect-delivery|shipments|returns|checkouts)(\/|$)/, 'orders'),
  rule(/^\/(offers|cashback-settings|spin|push-campaigns|first-order-guard)(\/|$)/, 'promotions'),
  rule(/^\/referral-settings(\/|$)/, 'referrals'),
  rule(/^\/customers(\/|$)/, 'customers'),

  rule(/^\/(delivery|delivery-cash-limit|delivery-emergency-help|driver-registration-fields)(\/|$)/, 'delivery'),
  rule(/^\/fee-settings(\/|$)/, 'fee_settings'),

  rule(/^\/(pages-social-media|notifications|seller-app-banners|quick-home-layout)(\/|$)/, 'cms'),
  rule(/^\/(business-settings|feature-settings|power-scanning|ai)(\/|$)/, 'settings'),
];

export function resolveShopAdminResource(path, method) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '').split('?')[0];
  for (const r of SHOP_ADMIN_RULES) {
    if (r.methods && !r.methods.includes(m === 'HEAD' ? 'GET' : m)) continue;
    if (r.pattern.test(p)) return r.resource;
  }
  return null;
}
