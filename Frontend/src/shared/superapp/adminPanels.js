/**
 * The admin panels, once, for every admin layout's service switcher.
 *
 * Each panel (Food, Taxi, Services, Shop) draws its own switcher, and each had
 * its own hand-written list: the Services one had no Shop and no Master, and
 * showed every tab to every admin, so a sub-admin could click into panels that
 * then refused them. They now read this list and this rule.
 *
 * `service` is the servicesAccess key the backend checks
 * (core/admin/adminAccessPolicy.js); `enabled: false` is a service this site
 * does not run (config/features.js).
 */
import { SERVICE_PROVIDER_ENABLED, ECOMMERCE_ENABLED } from "@/config/features"
import { canOpenPath, hasPanel } from "@food/utils/adminAccess"

/** Medical is hidden from every panel switcher for now; its pages still work by URL. */
export const MEDICAL_TAB_ENABLED = false

export const ADMIN_PANELS = [
  { service: "food", label: "Food", path: "/admin/food", base: "/admin/food" },
  { service: "taxi", label: "Taxi", path: "/taxi/admin/dashboard", base: "/taxi/admin" },
  { service: "serviceProvider", label: "Services", path: "/admin/sp/dashboard", base: "/admin/sp", enabled: SERVICE_PROVIDER_ENABLED },
  { service: "quickCommerce", label: "Quick", path: "/admin/quick-commerce", base: "/admin/quick-commerce" },
  { service: "medical", label: "Medical", path: "/admin/medical", base: "/admin/medical", enabled: MEDICAL_TAB_ENABLED },
  { service: "ecommerce", label: "Shop", path: "/admin/shop", base: "/admin/shop", enabled: ECOMMERCE_ENABLED },
]

/** The panels this admin may open, in switcher order. */
export const visibleAdminPanels = (access) =>
  ADMIN_PANELS.filter((p) => p.enabled !== false && hasPanel(access, p.service))

/** Which panel a path belongs to, or null. */
export const adminPanelOfPath = (pathname = "") =>
  ADMIN_PANELS.find((p) => pathname === p.base || pathname.startsWith(`${p.base}/`)) || null

/**
 * Where Master opens for this admin, or null. Not owner-only: a sub-admin given
 * the `subadmins` permission may open Admin Accounts though not the rest.
 */
export const masterEntryFor = (access) =>
  ["/admin/master/settings", "/admin/master/admins"].find((path) => canOpenPath(access, path)) || null
