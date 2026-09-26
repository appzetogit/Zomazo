/**
 * API client for the Shop (e-commerce) module.
 * - Talks to the platform's /api/v1/ecom mount; request paths stay as the
 *   standalone app wrote them (/catalog/..., /user/..., /seller/...).
 * - Attaches Bearer token (user, seller or admin based on request URL). Customer
 *   and admin tokens are the platform's own (user_accessToken, admin_accessToken)
 *   -- the same keys the rest of the platform writes -- so one sign-in covers
 *   the Shop. Sellers have their own login here.
 * - On 401: attempts refresh, retries once; signs out only when the server
 *   rejects the refresh token.
 */

import axios from "axios";

// The platform API root (VITE_API_BASE_URL, or same-origin /api/v1 via proxy).
const platformRoot =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, "")
    : "/api/v1"; // same origin: the dev server and the production host proxy it

// Every Shop request goes to the e-commerce mount.
const baseURL = `${platformRoot}/ecom`;

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

    // No client-side admin RBAC here. The standalone app read per-section
    // permissions from its own admin_user shape; the platform's admin_user has a
    // different one, so every platform admin was refused before the request
    // left the browser. The server decides (servicesAccess + the module's
    // permission check).

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
    // A failed sign-in is a wrong code or password, not an expired session.
    if (/\/auth\/[^?]*(request-otp|verify-otp|login)/.test(String(original.url || ""))) {
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
      // Plain axios to avoid interceptor recursion.
      //
      // Customer and admin sessions are the platform's, so they refresh where
      // they were issued (the rest of the platform uses /food/auth). A seller's
      // session was issued by this module, so it refreshes here.
      const refreshUrl = module === "seller"
        ? `${baseURL}/auth/refresh-token`
        : `${platformRoot}/food/auth/refresh-token`;
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
    } catch (refreshError) {
      // Sign out ONLY when the server rejected the refresh token. A 502 while
      // the API restarts, a dropped connection or a 429 is not a reason to throw
      // away a still-valid session -- the rest of the platform learned this
      // the hard way (services/api/axios.js).
      const status = refreshError?.response?.status;
      if (status === 400 || status === 401 || status === 403) {
        onRefreshFailed(module);
      } else {
        refreshSubscribers.forEach((cb) => cb(null, module));
        refreshSubscribers = [];
      }
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }

    onRefreshFailed(module);
    return Promise.reject(err);
  }
);

export default apiClient;
