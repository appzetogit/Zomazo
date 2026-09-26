import { getCurrentUser } from "@store/utils/auth";

export const ADMIN_ACTIONS = ["view", "create", "edit", "delete", "export"];

export const ADMIN_PERMISSION_SECTIONS = [
  "dashboard",
  "point_of_sale",
  "product_management",
  "seller_management",
  "order_management",
  "promotions_management",
  "referral_rewards",
  "customer_management",
  "delivery_management",
  "support_management",
  "report_management",
  "transaction_management",
  "banner_management",
  "pages_social_media",
];

const PATH_PREFIX_TO_SECTION = [
  { prefix: "/point-of-sale", section: "point_of_sale" },
  { prefix: "/fee-settings", section: "delivery_management" },
  { prefix: "/delivery-cash-limit", section: "delivery_management" },
  { prefix: "/cash-limit-settlement", section: "delivery_management" },
  { prefix: "/delivery-withdrawal", section: "delivery_management" },
  { prefix: "/delivery-boy-wallet", section: "delivery_management" },
  { prefix: "/delivery-emergency-help", section: "delivery_management" },
  { prefix: "/delivery-support-tickets", section: "delivery_management" },
  { prefix: "/delivery-order-reassignment-requests", section: "delivery_management" },
  { prefix: "/product-approval", section: "product_management" },
  { prefix: "/products", section: "product_management" },
  // Legacy twins of the routes above. The router still serves them so old
  // bookmarks resolve, and without a prefix here those visits would match no
  // section and be refused for someone who is allowed in.
  { prefix: "/products", section: "product_management" },
  { prefix: "/categories", section: "product_management" },
  { prefix: "/zone-setup", section: "seller_management" },
  { prefix: "/sellers", section: "seller_management" },
  { prefix: "/sellers", section: "seller_management" },
  { prefix: "/orders", section: "order_management" },
  { prefix: "/order-detect-delivery", section: "order_management" },
  { prefix: "/coupons", section: "promotions_management" },
  { prefix: "/referral-settings", section: "referral_rewards" },
  { prefix: "/customers", section: "customer_management" },
  { prefix: "/support-tickets", section: "customer_management" },
  { prefix: "/delivery", section: "delivery_management" },
  { prefix: "/delivery-partners", section: "delivery_management" },
  { prefix: "/contact-messages", section: "support_management" },
  { prefix: "/safety-emergency-reports", section: "support_management" },
  { prefix: "/transaction-report", section: "report_management" },
  { prefix: "/order-report", section: "report_management" },
  { prefix: "/tax-report", section: "report_management" },
  { prefix: "/seller-report", section: "report_management" },
  { prefix: "/customer-report", section: "report_management" },
  { prefix: "/seller-withdraws", section: "transaction_management" },
  // The same sections the backend enforces for these API paths.
  { prefix: "/reports", section: "report_management" },
  { prefix: "/payments/reconciliation", section: "report_management" },
  { prefix: "/coins", section: "transaction_management" },
  { prefix: "/spin-campaigns", section: "promotions_management" },
  { prefix: "/push-campaigns", section: "promotions_management" },
  { prefix: "/shipments", section: "order_management" },
  { prefix: "/returns", section: "order_management" },
  { prefix: "/cod-remittances", section: "report_management" },
  { prefix: "/checkouts", section: "order_management" },
  { prefix: "/ai/", section: "system_settings" },
  { prefix: "/attributes", section: "product_management" },
  { prefix: "/product-reviews", section: "product_management" },
  { prefix: "/low-stock", section: "product_management" },
  { prefix: "/first-order-claims", section: "promotions_management" },
  { prefix: "/hero-banner-management", section: "banner_management" },
  { prefix: "/quick-home-layout", section: "banner_management" },
  { prefix: "/promotional-banner", section: "banner_management" },
  { prefix: "/feature-settings", section: "system_settings" },
  { prefix: "/power-scanning", section: "system_settings" },
  { prefix: "/business-setup", section: "system_settings" },
  { prefix: "/broadcast-notification", section: "system_settings" },
  { prefix: "/pages-social-media", section: "pages_social_media" },
  { prefix: "/employees", section: "sub_admin_management" },
  { prefix: "/employee-role", section: "sub_admin_management" },
];

const ALWAYS_ALLOWED_FOR_SUB_ADMIN = new Set([
  "/profile",
  "/settings",
]);

export function isSuperAdmin(adminUser) {
  const type = String(adminUser?.adminType || "").trim().toLowerCase();
  return type === "super_admin";
}

export function getAdminPermissions(adminUser) {
  return adminUser?.effectivePermissions || adminUser?.permissions || {};
}

export function canAdminAccess(adminUser, section, action = "view") {
  if (!section) return true;
  if (isSuperAdmin(adminUser)) return true;
  const permissions = getAdminPermissions(adminUser);
  const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
  return actions.includes(action);
}

// The prefixes above are relative to the panel base: the same pages are served
// under /admin/quick and /admin/shop (and the legacy /admin/store, which redirects).
const ADMIN_PANEL_PREFIX = /^\/admin\/(quick|shop|store)(?=\/|$)/;

const toPanelSubPath = (pathname = "") =>
  String(pathname || "").replace(ADMIN_PANEL_PREFIX, "").replace(/\/+$/, "");

export function resolvePermissionSectionByPath(pathname = "") {
  if (!ADMIN_PANEL_PREFIX.test(String(pathname || ""))) return null;
  const subPath = toPanelSubPath(pathname);
  if (subPath === "") return "dashboard";
  const match = PATH_PREFIX_TO_SECTION.find((item) => subPath.startsWith(item.prefix));
  return match?.section || null;
}

export function canAccessAdminPath(pathname, action = "view") {
  const adminUser = getCurrentUser("admin");
  const section = resolvePermissionSectionByPath(pathname);
  if (!section) {
    if (isSuperAdmin(adminUser)) return true;
    return (
      ADMIN_PANEL_PREFIX.test(String(pathname || "")) &&
      ALWAYS_ALLOWED_FOR_SUB_ADMIN.has(toPanelSubPath(pathname))
    );
  }
  return canAdminAccess(adminUser, section, action);
}

export function canCurrentAdminAction(action = "view", pathname = "") {
  const adminUser = getCurrentUser("admin");
  const currentPath =
    pathname || (typeof window !== "undefined" ? window.location.pathname : "");
  const section = resolvePermissionSectionByPath(currentPath);
  if (!section) {
    return isSuperAdmin(adminUser);
  }
  return canAdminAccess(adminUser, section, action);
}

export function findFirstAllowedAdminPath(adminUser, panel = "quick") {
  const base = `/admin/${panel === "shop" ? "shop" : "quick"}`;
  const sectionHomePath = {
    dashboard: `${base}`,
    point_of_sale: `${base}/point-of-sale`,
    product_management: `${base}/product-approval`,
    seller_management: `${base}/sellers`,
    order_management: `${base}/orders/all`,
    promotions_management: `${base}/coupons`,
    referral_rewards: `${base}/referral-settings`,
    customer_management: `${base}/customers`,
    delivery_management: `${base}/delivery-partners`,
    support_management: `${base}/contact-messages`,
    report_management: `${base}/transaction-report`,
    transaction_management: `${base}/seller-withdraws`,
    banner_management: `${base}/hero-banner-management`,
    pages_social_media: `${base}/pages-social-media/about`,
  };

  if (isSuperAdmin(adminUser)) {
    return `${base}`;
  }

  for (const section of ADMIN_PERMISSION_SECTIONS) {
    if (canAdminAccess(adminUser, section, "view")) {
      return sectionHomePath[section] || `${base}/profile`;
    }
  }

  return `${base}/profile`;
}
