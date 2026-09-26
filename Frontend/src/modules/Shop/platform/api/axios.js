/**
 * Central API client for backend (auth and future APIs).
 * - baseURL from VITE_API_BASE_URL (e.g. http://localhost:5000/api/v1)
 * - When baseURL ends with /api/v1, request paths must NOT include /v1 (use /catalog/..., /auth/...)
 * - Attaches Bearer token (user or admin based on request URL)
 * - On 401: attempts refresh, retries once; on refresh failure logs out
 */

import axios from "axios";

// Prefer explicit env. If not set, use same-origin (works with a Vite proxy).
// This avoids hardcoding ports like 5000 that may conflict with local setups.
const baseURL =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, "")
    : "/api/v1"; // same origin: the dev server and the production host proxy it

/**
 * A stable id for this browser, sent as X-Device-Id (first-order offers are
 * limited to one per device). Random, generated once, kept in localStorage.
 */
const DEVICE_ID_KEY = "app_device_id";
let cachedDeviceId = "";
const getDeviceId = () => {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !/^[A-Za-z0-9._:-]{8,128}$/.test(id)) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? `web-${crypto.randomUUID()}`
          : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    cachedDeviceId = id;
  } catch {
    // Storage blocked: a per-session id still identifies this tab.
    cachedDeviceId = cachedDeviceId || `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  return cachedDeviceId;
};

const apiClient = axios.create({
  baseURL: baseURL || undefined,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

const ADMIN_PERMISSION_PATH_MAP = [
  { prefix: "/admin/sub-admins", section: "sub_admin_management" },
  { prefix: "/admin/customers", section: "customer_management" },
  { prefix: "/admin/support-tickets", section: "customer_management" },
  { prefix: "/admin/sellers", section: "seller_management" },
  { prefix: "/admin/seller-settings", section: "seller_management" },
  { prefix: "/admin/seller-subscription-settings", section: "seller_management" },
  { prefix: "/admin/seller-subscriptions", section: "seller_management" },
  { prefix: "/admin/zones", section: "seller_management" },
  { prefix: "/admin/categories", section: "product_management" },
  { prefix: "/admin/products", section: "product_management" },
  { prefix: "/admin/offers", section: "promotions_management" },
  { prefix: "/admin/push-campaigns", section: "promotions_management" },
  { prefix: "/admin/first-order-guard", section: "promotions_management" },
  { prefix: "/admin/orders", section: "order_management" },
  { prefix: "/admin/shipments", section: "order_management" },
  { prefix: "/admin/returns", section: "order_management" },
  { prefix: "/admin/checkouts", section: "order_management" },
  { prefix: "/admin/cod-remittances", section: "report_management" },
  { prefix: "/admin/spin", section: "promotions_management" },
  { prefix: "/admin/coins", section: "transaction_management" },
  { prefix: "/admin/attributes", section: "product_management" },
  { prefix: "/admin/attribute-sets", section: "product_management" },
  { prefix: "/admin/product-reviews", section: "product_management" },
  { prefix: "/admin/inventory", section: "product_management" },
  { prefix: "/admin/ai", section: "system_settings" },
  { prefix: "/admin/order-detect-delivery", section: "order_management" },
  { prefix: "/admin/sidebar-badges", section: "dashboard" },
  { prefix: "/admin/dashboard-stats", section: "dashboard" },
  { prefix: "/admin/referral-settings", section: "referral_rewards" },
  { prefix: "/admin/delivery", section: "delivery_management" },
  { prefix: "/admin/fee-settings", section: "delivery_management" },
  { prefix: "/admin/delivery-cash-limit", section: "delivery_management" },
  { prefix: "/admin/cash-limit-settlements", section: "delivery_management" },
  { prefix: "/admin/cash-limit-settlement", section: "delivery_management" },
  { prefix: "/admin/withdrawals", section: "transaction_management" },
  { prefix: "/admin/reports", section: "report_management" },
  { prefix: "/admin/feedback-experiences", section: "report_management" },
  { prefix: "/content/hero-banners", section: "banner_management" },
  { prefix: "/admin/quick-home-layout", section: "banner_management" },
  { prefix: "/admin/contact-messages", section: "support_management" },
  { prefix: "/admin/safety-emergency-reports", section: "support_management" },
  { prefix: "/admin/feature-settings", section: "system_settings" },
  { prefix: "/admin/business-settings", section: "system_settings" },
  { prefix: "/admin/power-scanning", section: "system_settings" },
  { prefix: "/admin/notifications", section: "system_settings" },
  { prefix: "/admin/pages-social-media", section: "pages_social_media" },
];

const normalizePath = (url) => {
  const raw = String(url || "");
  const noQuery = raw.split("?")[0].split("#")[0];
  if (noQuery.startsWith("http://") || noQuery.startsWith("https://")) {
    try {
      const parsed = new URL(noQuery);
      return parsed.pathname || "/";
    } catch {
      return noQuery;
    }
  }
  return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
};

const resolveAdminSectionByApiPath = (url, method = "GET") => {
  const path = normalizePath(url).toLowerCase();
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (path === "/admin/zones" && normalizedMethod === "GET") {
    return "seller_management";
  }
  const match = ADMIN_PERMISSION_PATH_MAP.find((item) => path.startsWith(item.prefix));
  return match?.section || null;
};

const resolveActionByMethod = (method) => {
  const normalized = String(method || "get").toUpperCase();
  if (normalized === "GET") return "view";
  if (normalized === "POST") return "create";
  if (normalized === "DELETE") return "delete";
  if (normalized === "PATCH" || normalized === "PUT") return "edit";
  return "view";
};

const getAdminUser = () => {
  try {
    const raw = localStorage.getItem("admin_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const isAdminAllowedForAction = (section, action) => {
  const adminUser = getAdminUser();
  const adminType = String(adminUser?.adminType || "").trim().toLowerCase();
  if (adminType === "super_admin") return true;
  if (!section) return false;
  const permissions = adminUser?.effectivePermissions || adminUser?.permissions || {};
  const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
  return actions.includes(action);
};

const hasAdminAction = (adminUser, section, action = "view") => {
  const permissions = adminUser?.effectivePermissions || adminUser?.permissions || {};
  const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
  return actions.includes(action);
};

function getModuleFromUrl(url = "") {
  const u = typeof url === "string" ? url : (url?.url || "");
  if (!u) return "user";

  // Which signed-in role a request belongs to decides which token it carries.
  // Paths are grouped by audience (/admin, /seller, /delivery, ...); auth and
  // payments put the role one segment down (/auth/seller/..., /payments/seller/...).
  const path = normalizePath(u).toLowerCase().replace(/^\/api\/v1(?=\/)/, "");
  const [, first = "", second = ""] = path.split("/");
  const area = first === "auth" || first === "payments" ? second : first;

  if (area === "admin") return "admin";
  // Banner management sits under /content next to the public banner reads, and
  // needs the admin token; only the /public reads are open.
  if (first === "content" && (second === "hero-banners" || second === "top-banners") && !path.endsWith("/public")) {
    return "admin";
  }
  if (area === "delivery") return "delivery";
  if (area === "seller") return "seller";
  return "user";
}

function getModuleFromConfig(config) {
  if (config?.contextModule) return config.contextModule;
  return getModuleFromUrl(config?.url);
}

function getAccessToken(config) {
  const module = getModuleFromConfig(config);
  const key = `${module}_accessToken`;
  try {
    // 1. Try module-specific token first
    const moduleToken = localStorage.getItem(key);
    if (moduleToken) return moduleToken;
    
    // 2. Fallback to generic token only for non-admin modules
    if (module !== "admin") {
      return localStorage.getItem("accessToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

function getRefreshToken(module) {
  try {
    // 1. Try module-specific refresh token
    const moduleRefreshToken = localStorage.getItem(`${module}_refreshToken`);
    if (moduleRefreshToken) return moduleRefreshToken;
    
    // 2. Fallback to generic refresh token only for non-admin modules
    if (module !== "admin") {
      return localStorage.getItem("refreshToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

function clearModuleAuth(module) {
  try {
    localStorage.removeItem(`${module}_accessToken`);
    localStorage.removeItem(`${module}_refreshToken`);
    localStorage.removeItem(`${module}_authenticated`);
    localStorage.removeItem(`${module}_user`);
  } catch (_) {}
}

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeToRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(newToken, module) {
  refreshSubscribers.forEach((cb) => cb(newToken, module));
  refreshSubscribers = [];
}

function onRefreshFailed(module) {
  clearModuleAuth(module);
  // Fail any queued requests that were waiting for this refresh
  refreshSubscribers.forEach((cb) => cb(null, module));
  refreshSubscribers = [];
  
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("authRefreshFailed", { detail: { module } }));
  }
}

apiClient.interceptors.request.use(
  (config) => {
    config.contextModule = getModuleFromConfig(config);

    // Client-side RBAC safety net for sub-admins across all admin APIs.
    if (config.contextModule === "admin") {
      const path = normalizePath(config?.url);
      const normalizedPath = String(path || "").toLowerCase();
      const isPublicAdminEndpoint =
        normalizedPath.startsWith("/admin/") &&
        normalizedPath.endsWith("/public");
      const isAuthEndpoint =
        path.includes("/auth/admin/login") ||
        path.includes("/auth/me") ||
        path.includes("/auth/refresh-token") ||
        path.includes("/auth/logout");

      if (!isAuthEndpoint && !isPublicAdminEndpoint) {
        const action = resolveActionByMethod(config?.method);
        const isSellerListRead = normalizedPath === "/admin/sellers" && action === "view";
        const isSellerDetailRead =
          /^\/admin\/sellers\/[^/]+$/.test(normalizedPath) && action === "view";
        const isSellerAnalyticsRead =
          /^\/admin\/sellers\/[^/]+\/analytics$/.test(normalizedPath) && action === "view";
        const isOrdersRead = normalizedPath === "/admin/orders" && action === "view";
        const isCustomersRead = normalizedPath === "/admin/customers" && action === "view";
        const isZonesRead = normalizedPath === "/admin/zones" && action === "view";
        const isZoneDetailRead =
          /^\/admin\/zones\/[^/]+$/.test(normalizedPath) && action === "view";

        // POS dropdown needs seller list read access.
        if (isSellerListRead || isSellerDetailRead || isSellerAnalyticsRead) {
          const adminUser = getAdminUser();
          const adminType = String(adminUser?.adminType || "").trim().toLowerCase();
          const isAllowed =
            adminType === "super_admin" ||
            hasAdminAction(adminUser, "seller_management", "view") ||
            hasAdminAction(adminUser, "point_of_sale", "view") ||
            hasAdminAction(adminUser, "report_management", "view") ||
            hasAdminAction(adminUser, "banner_management", "view");
          if (!isAllowed) {
            const error = new Error("Insufficient permissions for this action");
            error.response = {
              status: 403,
              data: { message: "Insufficient permissions for this action" },
            };
            return Promise.reject(error);
          }
        } else if (isZonesRead || isZoneDetailRead) {
          const adminUser = getAdminUser();
          const adminType = String(adminUser?.adminType || "").trim().toLowerCase();
          const isAllowed =
            adminType === "super_admin" ||
            hasAdminAction(adminUser, "dashboard", "view") ||
            hasAdminAction(adminUser, "seller_management", "view") ||
            hasAdminAction(adminUser, "point_of_sale", "view") ||
            hasAdminAction(adminUser, "product_management", "view") ||
            hasAdminAction(adminUser, "delivery_management", "view") ||
            hasAdminAction(adminUser, "report_management", "view");
          if (!isAllowed) {
            const error = new Error("Insufficient permissions for this action");
            error.response = {
              status: 403,
              data: { message: "Insufficient permissions for this action" },
            };
            return Promise.reject(error);
          }
        } else if (isOrdersRead) {
          const adminUser = getAdminUser();
          const adminType = String(adminUser?.adminType || "").trim().toLowerCase();
          const isAllowed =
            adminType === "super_admin" ||
            hasAdminAction(adminUser, "order_management", "view") ||
            hasAdminAction(adminUser, "report_management", "view");
          if (!isAllowed) {
            const error = new Error("Insufficient permissions for this action");
            error.response = {
              status: 403,
              data: { message: "Insufficient permissions for this action" },
            };
            return Promise.reject(error);
          }
        } else if (isCustomersRead) {
          const adminUser = getAdminUser();
          const adminType = String(adminUser?.adminType || "").trim().toLowerCase();
          const isAllowed =
            adminType === "super_admin" ||
            hasAdminAction(adminUser, "customer_management", "view") ||
            hasAdminAction(adminUser, "report_management", "view");
          if (!isAllowed) {
            const error = new Error("Insufficient permissions for this action");
            error.response = {
              status: 403,
              data: { message: "Insufficient permissions for this action" },
            };
            return Promise.reject(error);
          }
        } else {
          const section = resolveAdminSectionByApiPath(path, config?.method);
          if (!isAdminAllowedForAction(section, action)) {
            const error = new Error("Insufficient permissions for this action");
            error.response = {
              status: 403,
              data: { message: "Insufficient permissions for this action" },
            };
            return Promise.reject(error);
          }
        }
      }
    }

    // If sending FormData, let the browser set proper multipart boundary.
    if (config.data instanceof FormData) {
      if (config.headers && config.headers["Content-Type"]) {
        delete config.headers["Content-Type"];
      }
    }

    const token = getAccessToken(config);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (config.headers) config.headers["X-Device-Id"] = getDeviceId();
    return config;
  },
  (err) => Promise.reject(err)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (err) => {
    const original = err?.config;
    if (err?.response?.status === 429) {
      const retryAfter = err?.response?.data?.retryAfterSeconds;
      const message =
        err?.response?.data?.message ||
        "Too many requests. Please wait and try again.";
      err.rateLimitMessage = retryAfter
        ? `${message} (retry in ~${retryAfter}s)`
        : message;
      return Promise.reject(err);
    }
    if (err?.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(err);
    }
    const module = original.contextModule || getModuleFromUrl(original.url);
    const refreshToken = getRefreshToken(module);
    if (!refreshToken) {
      clearModuleAuth(module);
      return Promise.reject(err);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((newToken) => {
          if (newToken) {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(original));
          } else {
            reject(err);
          }
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      // Use relative URL so this works both with an explicit baseURL and with a dev proxy.
      // Use plain axios to avoid interceptor recursion.
      const refreshUrl = baseURL ? `${baseURL}/auth/refresh-token` : "/api/v1/auth/refresh-token";
      const { data } = await axios.post(refreshUrl, { refreshToken }, { timeout: 10000 });
      const newAccessToken = data?.data?.accessToken || data?.accessToken;
      if (newAccessToken) {
        try {
          localStorage.setItem(`${module}_accessToken`, newAccessToken);
          // Dispatch a custom event specifically for the module that refreshed
          window.dispatchEvent(new CustomEvent("authRefreshed", { 
            detail: { module, token: newAccessToken } 
          }));
        } catch (_) {}
        onRefreshed(newAccessToken, module);
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(original);
      }
    } catch (_) {
      onRefreshFailed(module);
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }

    onRefreshFailed(module);
    return Promise.reject(err);
  }
);

export default apiClient;
