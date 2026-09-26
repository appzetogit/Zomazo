/**
 * API layer - auth connected to new backend; rest stubbed for UI compatibility.
 */

import apiClient from "./axios.js";
import { API_BASE_URL, API_ENDPOINTS } from "./config.js";
import * as authService from "./auth.js";
import { resolveMediaUrl } from "../../shared/utils/mediaUrl.js";

const stub = () =>
  Promise.resolve({
    data: { success: false, message: "Backend not connected", data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

/** Search API - unified search for user app */
export const searchAPI = {
  unifiedSearch: (params = {}) =>
    apiClient.get("/catalog/search/unified", { params }),
  getAdminCategories: (params = {}) =>
    apiClient.get("/catalog/search/categories/admin", { params }),
  /**
   * Product grid search. `attrs` is `{ Size: ["M", "L"], Color: ["Red"] }`;
   * every chosen attribute must hold on one variant. Pass `facets: true` for
   * the filter sheet's counts.
   */
  searchProducts: ({ attrs = {}, ...params } = {}) => {
    const query = { ...params };
    for (const [name, values] of Object.entries(attrs)) {
      const list = (Array.isArray(values) ? values : [values]).filter(Boolean);
      if (list.length) query[`attr[${name}]`] = list.join(",");
    }
    return apiClient.get("/catalog/search/products", { params: query });
  },
};

/** Public catalogue reads that aren't tied to one store's menu. */
export const catalogAPI = {
  /** One product with all variants, its picker `options` and its store. */
  getProduct: (id) => apiClient.get(`/catalog/products/${id}`),
  /** Approved stores nearest first; `{ lat, lng, radiusKm, limit }`. */
  getNearbyStores: (params = {}) =>
    apiClient.get("/catalog/stores/nearby", { params }),
  /** Filterable attributes (Size, Color…) with values and swatch colours. */
  getAttributes: () => apiClient.get("/catalog/attributes"),
  /** The attributes a category's products vary by, for the variant editor. */
  getCategoryAttributes: (categoryId) =>
    apiClient.get(`/catalog/categories/${categoryId}/attributes`),
  /** `{ type: "frequently_bought" | "similar", fulfilmentMode, limit }` */
  getProductRecommendations: (id, params = {}) =>
    apiClient.get(`/catalog/products/${id}/recommendations`, { params }),
  /**
   * Visible reviews + `summary { averageRating, totalRatings, histogram }`.
   * `{ sort: "newest" | "helpful", rating, withPhotos, page, limit }`. Signed in:
   * adds `votedHelpful`/`isMine` per review and `myReview`.
   */
  getProductReviews: (id, params = {}) =>
    apiClient.get(`/catalog/products/${id}/reviews`, { params }),
  /** Shop delivery window `{ minDays, maxDays, fromDate, toDate }`; `{ pincode, fulfilmentMode: "standard" }`. */
  getDeliveryEstimate: (params = {}) =>
    apiClient.get("/catalog/delivery-estimate", { params }),
  /** The Quick phone home: themes, featured cards, campaigns and category groups. */
  getQuickHome: (zoneId) =>
    apiClient.get("/content/quick-home", { params: zoneId ? { zoneId } : {} }),
};

/** Admin management of attributes and the sets that attach them to categories. */
export const attributeAdminAPI = {
  listAttributes: (params = {}) =>
    apiClient.get("/admin/attributes", { params, contextModule: "admin" }),
  createAttribute: (body) =>
    apiClient.post("/admin/attributes", body, { contextModule: "admin" }),
  updateAttribute: (id, body) =>
    apiClient.patch(`/admin/attributes/${id}`, body, { contextModule: "admin" }),
  deleteAttribute: (id) =>
    apiClient.delete(`/admin/attributes/${id}`, { contextModule: "admin" }),
  listSets: (params = {}) =>
    apiClient.get("/admin/attribute-sets", { params, contextModule: "admin" }),
  createSet: (body) =>
    apiClient.post("/admin/attribute-sets", body, { contextModule: "admin" }),
  updateSet: (id, body) =>
    apiClient.patch(`/admin/attribute-sets/${id}`, body, { contextModule: "admin" }),
  deleteSet: (id) =>
    apiClient.delete(`/admin/attribute-sets/${id}`, { contextModule: "admin" }),
};

const createStubAPI = () =>
  new Proxy(
    {},
    {
      get(_, prop) {
        return () => stub();
      },
    },
  );

export default apiClient;
export { API_ENDPOINTS };

/** Resolve FCM token for logout without importing firebaseMessaging at top-level (avoids circular deps). */
async function resolveLogoutFcmToken(moduleName) {
  // Prefer full resolver (Flutter + cache + live web getToken) when available.
  try {
    const { resolveDeviceFcmToken } = await import(
      "../../modules/Store/utils/firebaseMessaging.js"
    );
    if (typeof resolveDeviceFcmToken === "function") {
      return await resolveDeviceFcmToken(moduleName);
    }
  } catch {
    // Fall through to cache/Flutter-only path.
  }

  const cacheKey = `fcm_web_registered_token_${moduleName}`;
  if (typeof window === "undefined") {
    return { token: null, platform: "web" };
  }

  if (window.flutter_inappwebview) {
    const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
    for (const handlerName of handlerNames) {
      try {
        const t = await window.flutter_inappwebview.callHandler(handlerName, {
          module: moduleName,
        });
        if (t && typeof t === "string" && t.trim().length > 20) {
          return { token: t.trim(), platform: "mobile" };
        }
      } catch {
        // Try next handler.
      }
    }
  }

  const cached =
    typeof localStorage !== "undefined" ? localStorage.getItem(cacheKey) : null;
  return {
    token: cached && cached.length > 20 ? cached : null,
    platform: "web",
  };
}

// Stub for non-auth endpoints so we don't hit backend for unimplemented routes (avoids 404s and extra calls).
// Auth is done via authAPI/authService which use apiClient directly.
const emptyDataStub = () =>
  Promise.resolve({
    data: { success: false, data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

/** Single in-flight + short cache for user /auth/me to collapse duplicate page-load calls. */
let userMeInFlight = null;
let userMeCached = null;
let userMeCacheTime = 0;
const USER_ME_CACHE_MS = 3000;

const clearUserMeCache = () => {
  userMeInFlight = null;
  userMeCached = null;
  userMeCacheTime = 0;
};

const getUserMeOnce = (force = false) => {
  const now = Date.now();
  if (!force && userMeCached && now - userMeCacheTime < USER_ME_CACHE_MS) {
    return Promise.resolve(userMeCached);
  }
  if (!userMeInFlight) {
    userMeInFlight = authService
      .getMe("user")
      .then((res) => {
        userMeCached = res;
        userMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        userMeInFlight = null;
      });
  }
  return userMeInFlight;
};

export const api = {
  get: (_url, _config) => emptyDataStub(),
  post: (_url, _data, _config) => emptyDataStub(),
  put: (_url, _data, _config) => emptyDataStub(),
  patch: (_url, _data, _config) => emptyDataStub(),
  delete: (_url, _config) => emptyDataStub(),
};

/** Auth API - user OTP + admin login via new backend */
export const authAPI = {
  sendOTP: (phone, _purpose = "login", _email = null) => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestUserOtp(phone);
  },
  verifyOTP: (
    phone,
    otp,
    _purpose,
    _name,
    _email,
    _role,
    _password,
    _referralCode,
    fcmToken = null,
    platform = "web",
  ) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyUserOtp(
      phone,
      otp,
      _referralCode,
      _name,
      fcmToken,
      platform,
    );
  },
  getCurrentUser: () => getUserMeOnce(),
  refreshToken: (token) => authService.refreshToken(token),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    clearUserMeCache();
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("user_refreshToken")
        : null);
    return authService.logout(token, fcmToken, platform);
  },
};

export const supportAPI = {
  createTicket: (body) =>
    apiClient.post("/user/support/ticket", body ?? {}, {
      contextModule: "user",
    }),
  getMyTickets: (params = {}) =>
    apiClient.get("/user/support/my-tickets", {
      params,
      contextModule: "user",
    }),
  getSupportTicketsAdmin: (params = {}) =>
    apiClient.get("/admin/support-tickets", {
      params,
      contextModule: "admin",
    }),
  getUserSupportTicketStats: (params = {}) =>
    apiClient.get("/admin/support-tickets/stats", {
      params,
      contextModule: "admin",
    }),
  updateSupportTicketAdmin: (id, body = {}) =>
    apiClient.patch(`/admin/support-tickets/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
};

export const notificationAPI = {
  getInbox: (params = {}, config = {}) =>
    apiClient.get("/notifications/inbox", {
      params,
      ...config,
    }),
  markAsRead: (id, config = {}) =>
    apiClient.patch(`/notifications/${String(id)}/read`, {}, config),
  dismiss: (id, config = {}) =>
    apiClient.delete(`/notifications/${String(id)}`, config),
  dismissAll: (config = {}) =>
    apiClient.delete("/notifications/inbox/all", config),
  /** A campaign push was tapped. No sign-in needed: the push's signed openToken is the proof. */
  recordPushOpen: ({ deliveryId, openToken } = {}) =>
    apiClient.post("/notifications/opened", { deliveryId, openToken }),
};

/** Admin API - new backend only (GET /auth/me, PATCH /auth/admin/profile, POST /auth/admin/change-password) */
export const adminAPI = {
  /** GET /admin/product-reviews { status: all|visible|hidden|reported|removed, fulfilmentMode, rating, search, page, limit } */
  getProductReviews: (params = {}) =>
    apiClient.get("/admin/product-reviews", { params, contextModule: "admin" }),
  hideProductReview: (id, reason) =>
    apiClient.patch(`/admin/product-reviews/${id}/hide`, { reason }, { contextModule: "admin" }),
  unhideProductReview: (id, reason = "") =>
    apiClient.patch(`/admin/product-reviews/${id}/unhide`, { reason }, { contextModule: "admin" }),
  /** Soft delete with a reason; the review can't be reposted. */
  deleteProductReview: (id, reason) =>
    apiClient.delete(`/admin/product-reviews/${id}`, { data: { reason }, contextModule: "admin" }),
  // Push campaigns (scheduled, segmented marketing pushes)
  getPushCampaigns: (params = {}) =>
    apiClient.get("/admin/push-campaigns", { params, contextModule: "admin" }),
  getPushCampaign: (id) =>
    apiClient.get(`/admin/push-campaigns/${String(id)}`, { contextModule: "admin" }),
  createPushCampaign: (body = {}) =>
    apiClient.post("/admin/push-campaigns", body, { contextModule: "admin" }),
  updatePushCampaign: (id, body = {}) =>
    apiClient.patch(`/admin/push-campaigns/${String(id)}`, body, { contextModule: "admin" }),
  setPushCampaignState: (id, action) =>
    apiClient.post(`/admin/push-campaigns/${String(id)}/${action}`, {}, { contextModule: "admin" }),
  deletePushCampaign: (id) =>
    apiClient.delete(`/admin/push-campaigns/${String(id)}`, { contextModule: "admin" }),
  previewPushAudience: (audience = {}) =>
    apiClient.post("/admin/push-campaigns/audience-preview", { audience }, { contextModule: "admin" }),
  getPushCampaignSettings: () =>
    apiClient.get("/admin/push-campaigns/settings", { contextModule: "admin" }),
  updatePushCampaignSettings: (body = {}) =>
    apiClient.put("/admin/push-campaigns/settings", body, { contextModule: "admin" }),
  // First-order abuse guard
  getFirstOrderGuardSettings: () =>
    apiClient.get("/admin/first-order-guard/settings", { contextModule: "admin" }),
  updateFirstOrderGuardSettings: (body = {}) =>
    apiClient.put("/admin/first-order-guard/settings", body, { contextModule: "admin" }),
  getFirstOrderClaims: (params = {}) =>
    apiClient.get("/admin/first-order-guard/claims", { params, contextModule: "admin" }),
  /** Gives the offer back; the server allows it only when the claim's order was cancelled or is gone. */
  releaseFirstOrderClaim: (id) =>
    apiClient.post(`/admin/first-order-guard/claims/${id}/release`, {}, { contextModule: "admin" }),
  /** Products/variants at or below their low-stock alert. params: { channel, sellerId?, page?, limit? } */
  getLowStock: (params = {}) =>
    apiClient.get("/admin/inventory/low-stock", { params, contextModule: "admin" }),
  getSidebarBadges: (params = {}) =>
    apiClient.get("/admin/sidebar-badges", { params, contextModule: "admin" }),
  login: (email, password) => authService.adminLogin(email, password),
  /** POST /auth/admin/forgot-password/request-otp – only accepts registered admin email */
  requestForgotPasswordOtp: (email) =>
    apiClient.post("/auth/admin/forgot-password/request-otp", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
    }),
  /** POST /auth/admin/forgot-password/reset – verify OTP and set new password in one call */
  resetPasswordWithOtp: (email, otp, newPassword) =>
    apiClient.post("/auth/admin/forgot-password/reset", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
      otp: String(otp || "").replace(/\D/g, ""),
      newPassword: String(newPassword || ""),
    }),
  /** Raw /auth/me for admin (e.g. navbar). For Profile & Settings use getAdminProfile. */
  getCurrentAdmin: () => authService.getMe("admin"),
  /** Single API for admin profile: GET /auth/me, returns { data: { admin } }. Use on Profile & Settings only. */
  getAdminProfile: () =>
    authService.getMe("admin").then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { data: { data: { admin: user }, admin: user } };
    }),
  /** PATCH /auth/admin/profile. Body: name?, phone?, profileImage? */
  updateAdminProfile: (body) =>
    apiClient.patch("/auth/admin/profile", body ?? {}, {
      contextModule: "admin",
    }),
  /** POST /auth/admin/change-password */
  changePassword: (currentPassword, newPassword) =>
    apiClient.post(
      "/auth/admin/change-password",
      { currentPassword, newPassword },
      { contextModule: "admin" },
    ),
  logout: async (refreshToken) => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("admin_refreshToken")
        : null);
    const { token: fcmToken, platform } = await resolveLogoutFcmToken("admin");
    return authService.logout(token, fcmToken, platform);
  },
  // Seller approvals and join requests
  getPendingSellers: () =>
    apiClient.get("/admin/sellers/pending", {
      contextModule: "admin",
    }),
  getUnregisteredSellers: () =>
    apiClient.get("/admin/sellers/unregistered", {
      contextModule: "admin",
    }),
  deleteUnregisteredSeller: (id) =>
    apiClient.delete(`/admin/sellers/unregistered/${id}`, {
      contextModule: "admin",
    }),
  /** List seller complaints (admin). */
  getSellerComplaints: (params = {}) =>
    apiClient.get("/admin/sellers/complaints", {
      params,
      contextModule: "admin",
    }),
  getSellerComplaintStats: (params = {}) =>
    apiClient.get("/admin/sellers/complaints/stats", {
      params,
      contextModule: "admin",
    }),
  updateSellerComplaint: (id, body) =>
    apiClient.patch(`/admin/sellers/complaints/${id}`, body, {
      contextModule: "admin",
    }),
  /** Global universal search (admin). */
  globalSearch: (query) =>
    apiClient.get("/admin/global-search", {
      params: { query },
      contextModule: "admin",
    }),
  approveSeller: (id) =>
    apiClient.patch(
      `/admin/sellers/${id}/approve`,
      {},
      {
        contextModule: "admin",
      },
    ),
  rejectSeller: (id, reason) =>
    apiClient.patch(
      `/admin/sellers/${id}/reject`,
      { reason },
      { contextModule: "admin" },
    ),
  /** Approve or reject one sales channel. action: 'approve'|'reject'; reject needs a reason. */
  setSellerChannelStatus: (id, channel, action, reason) =>
    apiClient.patch(
      `/admin/sellers/${String(id)}/channels/${channel}`,
      action === "reject" ? { action, reason: String(reason || "").trim() } : { action },
      { contextModule: "admin" },
    ),
  /** Delivery partner join requests - uses /food/admin/delivery/* (new backend API) */
  getDeliveryPartnerJoinRequests: (params) =>
    apiClient.get("/admin/delivery/join-requests", {
      params,
      contextModule: "admin",
    }),
  getSellerSubscriptionSettings: () =>
    apiClient.get("/admin/seller-subscription-settings", {
      contextModule: "admin",
    }),
  getSellerOrderAcceptanceSettings: () =>
    apiClient.get("/admin/seller-settings/order-acceptance", {
      contextModule: "admin",
    }),
  updateSellerOrderAcceptanceSettings: (body = {}) =>
    apiClient.patch("/admin/seller-settings/order-acceptance", body ?? {}, {
      contextModule: "admin",
    }),
  getSellerSubscriptionHistory: (params = {}) =>
    apiClient.get("/admin/seller-subscriptions/history", {
      params,
      contextModule: "admin",
    }),
  updateSellerSubscriptionSettings: (body) =>
    apiClient.patch("/admin/seller-subscription-settings", body, {
      contextModule: "admin",
    }),
  /** Calendar-month postpaid subscription billing */
  getSubscriptionInvoicesAdmin: (params = {}) =>
    apiClient.get("/admin/seller-subscriptions/invoices", {
      params,
      contextModule: "admin",
    }),
  getSubscriptionInvoiceAdmin: (invoiceId) =>
    apiClient.get(`/admin/seller-subscriptions/invoices/${String(invoiceId)}`, {
      contextModule: "admin",
    }),
  getSubscriptionBillingSummary: (params = {}) =>
    apiClient.get("/admin/seller-subscriptions/summary", {
      params,
      contextModule: "admin",
    }),
  getSellerSubscriptionOverviewAdmin: (sellerId) =>
    apiClient.get(`/admin/seller-subscriptions/sellers/${String(sellerId)}/overview`, {
      contextModule: "admin",
    }),
  deductInvoiceFromWallet: (invoiceId, body = {}) =>
    apiClient.post(`/admin/seller-subscriptions/invoices/${String(invoiceId)}/deduct-wallet`, body, {
      contextModule: "admin",
    }),
  markInvoicePaid: (invoiceId, body = {}) =>
    apiClient.post(`/admin/seller-subscriptions/invoices/${String(invoiceId)}/mark-paid`, body, {
      contextModule: "admin",
    }),
  waiveInvoice: (invoiceId, body = {}) =>
    apiClient.post(`/admin/seller-subscriptions/invoices/${String(invoiceId)}/waive`, body, {
      contextModule: "admin",
    }),
  adjustInvoice: (invoiceId, body = {}) =>
    apiClient.post(`/admin/seller-subscriptions/invoices/${String(invoiceId)}/adjust`, body, {
      contextModule: "admin",
    }),
  runSubscriptionBilling: (billingMonth) =>
    apiClient.post("/admin/seller-subscriptions/run-billing", { billingMonth }, {
      contextModule: "admin",
    }),
  exportSubscriptionInvoices: (params = {}) =>
    apiClient.get("/admin/seller-subscriptions/invoices/export", {
      params,
      responseType: "blob",
      contextModule: "admin",
    }),
  getFeatureSettings: () =>
    apiClient.get("/admin/feature-settings", {
      contextModule: "admin",
    }),
  getPublicFeatureSettings: (config = {}) =>
    publicConfigGetOnce("/settings/features", {
      contextModule: "user",
      ...config,
    }),
  updateFeatureSetting: (key, body) =>
    apiClient.patch(`/admin/feature-settings/${String(key)}`, body ?? {}, {
      contextModule: "admin",
    }),
  getSubAdmins: (params = {}) =>
    apiClient.get("/admin/sub-admins", { params, contextModule: "admin" }),
  createSubAdmin: (body = {}) =>
    apiClient.post("/admin/sub-admins", body ?? {}, { contextModule: "admin" }),
  getSubAdminById: (id) =>
    apiClient.get(`/admin/sub-admins/${String(id)}`, { contextModule: "admin" }),
  updateSubAdmin: (id, body = {}) =>
    apiClient.patch(`/admin/sub-admins/${String(id)}`, body ?? {}, { contextModule: "admin" }),
  updateSubAdminPermissions: (id, permissions = {}) =>
    apiClient.patch(
      `/admin/sub-admins/${String(id)}/permissions`,
      { permissions },
      { contextModule: "admin" },
    ),
  updateSubAdminStatus: (id, isActive) =>
    apiClient.patch(
      `/admin/sub-admins/${String(id)}/status`,
      { isActive: Boolean(isActive) },
      { contextModule: "admin" },
    ),
  deleteSubAdmin: (id) =>
    apiClient.delete(`/admin/sub-admins/${String(id)}`, { contextModule: "admin" }),
  getSubAdminPermissionCatalog: () =>
    apiClient.get("/admin/sub-admins/permission-catalog", { contextModule: "admin" }),
  /** List approved delivery partners (Deliveryman List page) */
  getDeliveryPartners: (params) =>
    apiClient.get("/admin/delivery/partners", {
      params,
      contextModule: "admin",
    }),
  getDeliverymanReviews: (params = {}) =>
    apiClient.get("/admin/delivery/reviews", {
      params,
      contextModule: "admin",
    }),
  getContactMessages: (params = {}) =>
    apiClient.get("/admin/contact-messages", {
      params,
      contextModule: "admin",
    }),
  /** Dashboard summary stats (admin home) */
  getDashboardStats: (params = {}) =>
    apiClient.get("/admin/dashboard-stats", {
      params,
      contextModule: "admin",
    }),
  /** List seller withdrawal requests (admin). */
  getWithdrawals: (params = {}) =>
    apiClient.get("/admin/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a withdrawal request. */
  updateWithdrawalStatus: (id, body) =>
    apiClient.patch(`/admin/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** List delivery withdrawal requests (admin). */
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a delivery withdrawal request. */
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/admin/delivery/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** Delivery withdrawal aliases */
  getDeliveryWithdrawalRequests: (params) => adminAPI.getDeliveryWithdrawals(params),
  approveDeliveryWithdrawal: (id) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "approved" }),
  rejectDeliveryWithdrawal: (id, reason) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  // Aliases for SellerWithdraws page
  getWithdrawalRequests: (params) => adminAPI.getWithdrawals(params),
  approveWithdrawalRequest: (id) => adminAPI.updateWithdrawalStatus(id, { status: "approved" }),
  rejectWithdrawalRequest: (id, reason) => adminAPI.updateWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  /** Delivery boy wallets (stub until backend implements - returns empty so list still loads) */
  getDeliveryBoyWallets: (params) =>
    apiClient.get("/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  updateDeliveryBoyWallet: (body) =>
    apiClient.patch("/admin/delivery/wallets", body ?? {}, {
      contextModule: "admin",
    }),
  getDeliveryPartnerById: (id) =>
    apiClient.get(`/admin/delivery/${id}`, { contextModule: "admin" }),
  approveDeliveryPartner: (id) =>
    apiClient.patch(
      `/admin/delivery/${String(id)}/approve`,
      {},
      {
        contextModule: "admin",
      },
    ),
  rejectDeliveryPartner: (id, reason) =>
    apiClient.patch(
      `/admin/delivery/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      {
        contextModule: "admin",
      },
    ),
  updateDeliveryPartnerProfile: (id, body) =>
    apiClient.patch(`/admin/delivery/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteDeliveryPartner: (id) =>
    apiClient.delete(`/admin/delivery/${String(id)}`, {
      contextModule: "admin",
    }),
  /** GET /food/admin/delivery/support-tickets - list all delivery support tickets (query: status, priority, search, page, limit). */
  getDeliverySupportTickets: (params) =>
    apiClient.get("/admin/delivery/support-tickets", {
      params,
      contextModule: "admin",
    }),
  getExpiredFssaiNotifications: (params = {}) =>
    apiClient.get("/admin/notifications/fssai-expired", {
      params,
      contextModule: "admin",
    }),
  /** GET /food/admin/delivery/support-tickets/stats - counts by status. */
  getDeliverySupportTicketStats: () =>
    apiClient.get("/admin/delivery/support-tickets/stats", {
      contextModule: "admin",
    }),
  /** PATCH /food/admin/delivery/support-tickets/:id - update adminResponse, status. */
  updateDeliverySupportTicket: (id, body) =>
    apiClient.patch(`/admin/delivery/support-tickets/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  getOrderEmergencyRequests: (params = {}) =>
    apiClient.get("/admin/delivery/order-emergency-requests", {
      params,
      contextModule: "admin",
    }),
  getOrderEmergencyRequestById: (id) =>
    apiClient.get(
      `/admin/delivery/order-emergency-requests/${String(id)}`,
      { contextModule: "admin" },
    ),
  updateOrderEmergencyRequest: (id, body = {}) =>
    apiClient.patch(
      `/admin/delivery/order-emergency-requests/${String(id)}`,
      body,
      { contextModule: "admin" },
    ),
  deassignAndResendEmergencyOrder: (id) =>
    apiClient.patch(
      `/admin/delivery/order-emergency-requests/${String(id)}/deassign-resend`,
      {},
      { contextModule: "admin" },
    ),
  createBroadcastNotification: (body = {}) =>
    apiClient.post("/admin/notifications/broadcast", body ?? {}, {
      contextModule: "admin",
    }),
  getBroadcastNotifications: (params = {}) =>
    apiClient.get("/admin/notifications/broadcast", {
      params,
      contextModule: "admin",
    }),
  deleteBroadcastNotification: (id) =>
    apiClient.delete(`/admin/notifications/broadcast/${String(id)}`, {
      contextModule: "admin",
    }),
  /** List sellers for admin. Requires admin auth. */
  getSellers: (params = {}, config = {}) =>
    apiClient.get("/admin/sellers", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
      ...config,
    }),
  getSellerReviews: (params = {}) =>
    apiClient.get("/admin/sellers/reviews", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Categories (admin) */
  getCategories: (params = {}) =>
    apiClient.get("/admin/categories", { params, contextModule: "admin" }),
  createCategory: (body) =>
    apiClient.post("/admin/categories", body ?? {}, {
      contextModule: "admin",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/admin/categories/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/admin/categories/${id}`, {
      contextModule: "admin",
    }),
  approveCategory: (id) =>
    apiClient.patch(
      `/admin/categories/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectCategory: (id, reason) =>
    apiClient.patch(
      `/admin/categories/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  makeCategoryGlobal: (id) =>
    apiClient.patch(
      `/admin/categories/${String(id)}/make-global`,
      {},
      { contextModule: "admin" },
    ),
  toggleCategoryStatus: (id) =>
    apiClient.patch(
      `/admin/categories/${id}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Get single seller by id (full details for View Details modal). */
  getSellerById: (id) =>
    apiClient.get(`/admin/sellers/${id}`, { contextModule: "admin" }),
  /** Get seller analytics for POS. */
  getSellerAnalytics: (id) =>
    apiClient.get(`/admin/sellers/${id}/analytics`, {
      contextModule: "admin",
    }),
  /** Update seller basic details (admin). */
  updateSeller: (id, body) =>
    apiClient.patch(`/admin/sellers/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Update seller status (admin). Body: { status: boolean } */
  updateSellerStatus: (id, status) =>
    apiClient.patch(
      `/admin/sellers/${String(id)}/status`,
      { status: status !== false },
      { contextModule: "admin" },
    ),
  /** Update seller location (admin). Body includes lat/lng + address fields. */
  updateSellerLocation: (id, body) =>
    apiClient.patch(
      `/admin/sellers/${String(id)}/location`,
      body ?? {},
      { contextModule: "admin" },
    ),
  /** Products (admin) - separate collection */
  getProducts: (params = {}) =>
    apiClient.get("/admin/products", { params, contextModule: "admin" }),
  createProduct: (body) =>
    apiClient.post("/admin/products", body ?? {}, { contextModule: "admin" }),
  updateProduct: (id, body) =>
    apiClient.patch(`/admin/products/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteProduct: (id) =>
    apiClient.delete(`/admin/products/${id}`, { contextModule: "admin" }),
  /** Food approvals (admin) - pending items created by sellers */
  getPendingProductApprovals: (params = {}) =>
    apiClient.get("/admin/products/pending-approvals", {
      params,
      contextModule: "admin",
    }),
  approveProduct: (id) =>
    apiClient.patch(
      `/admin/products/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectProduct: (id, reason) =>
    apiClient.patch(
      `/admin/products/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  /** { productIds?: string[] (max 500), channel?: "quick"|"shop", sellerId? } — ids or channel required. */
  bulkApproveProducts: ({ productIds, channel, sellerId } = {}) =>
    apiClient.post(
      "/admin/products/bulk-approve",
      { productIds, channel, sellerId },
      { contextModule: "admin" },
    ),
  bulkUploadTemplate: () =>
    apiClient.get("/admin/products/bulk-upload/template", {
      responseType: "blob",
      contextModule: "admin",
    }),
  bulkUploadProducts: (sellerId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sellerId", String(sellerId));
    return apiClient.post("/admin/products/bulk-upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "admin",
    });
  },
  bulkDeleteProducts: (body) =>
    apiClient.post("/admin/products/bulk-delete", body ?? {}, {
      contextModule: "admin",
    }),
  /** Customers (admin) */
  getCustomers: (params = {}) =>
    apiClient.get("/admin/customers", { params, contextModule: "admin" }),
  getCustomerById: (id) =>
    apiClient.get(`/admin/customers/${String(id)}`, {
      contextModule: "admin",
    }),
  updateCustomerStatus: (id, isActive) =>
    apiClient.patch(
      `/admin/customers/${String(id)}/status`,
      { isActive: isActive !== false },
      { contextModule: "admin" },
    ),
  /** Orders (admin) – list, get by id, assign delivery partner */
  getOrders: (() => {
    const inFlight = new Map();
    const cache = new Map();
    const CACHE_MS = 2000;

    const stableKey = (params = {}) => {
      const normalized = { limit: 50, page: 1, ...params };
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, key) => {
            acc[key] = normalized[key];
            return acc;
          }, {}),
      );
    };

    const fetchOrders = (params = {}, options = {}) =>
      apiClient.get("/admin/orders", {
        params: { limit: 50, page: 1, ...params },
        contextModule: "admin",
        signal: options.signal,
      });

    return (params = {}, options = {}) => {
      if (options.force || options.signal) {
        return fetchOrders(params, options);
      }

      const key = stableKey(params);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS) {
        return Promise.resolve(cached.res);
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = fetchOrders(params, options)
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    };
  })(),
  getOrderById: (orderId) =>
    apiClient.get(`/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  acceptOrder: (orderId) =>
    apiClient.patch(`/admin/orders/${String(orderId)}/accept`, {}, {
      contextModule: "admin",
    }),
  rejectOrder: (orderId, reason) =>
    apiClient.patch(`/admin/orders/${String(orderId)}/reject`, { reason }, {
      contextModule: "admin",
    }),
  markOrderDelivered: (orderId, note) =>
    apiClient.patch(
      `/admin/orders/${String(orderId)}/mark-delivered`,
      note ? { note } : {},
      { contextModule: "admin" },
    ),
  deassignAndResendOrder: (orderId) =>
    apiClient.patch(
      `/admin/orders/${String(orderId)}/deassign-resend`,
      {},
      { contextModule: "admin" },
    ),
  resendDeliveryNotification: (orderId) =>
    apiClient.post(
      `/admin/orders/${String(orderId)}/resend-notification`,
      {},
      { contextModule: "admin" },
    ),
  processRefund: (orderId, data) =>
    apiClient.post(`/admin/orders/${String(orderId)}/refund`, data ?? {}, {
      contextModule: "admin",
    }),
  deleteOrder: (orderId) =>
    apiClient.delete(`/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  getUserCarts: (params = {}) =>
    apiClient.get("/admin/orders/user-carts", {
      params: { limit: 20, page: 1, ...params },
      contextModule: "admin",
    }),
  getUserCartPricing: (cartId) =>
    apiClient.get(`/admin/orders/user-carts/${String(cartId)}/pricing`, {
      contextModule: "admin",
    }),
  /** Dispatch settings – auto vs manual assign (global) */
  /** Create seller (admin). Single API: POST /food/admin/sellers. Body: JSON with image URLs. */
  createSeller: (body) =>
    apiClient.post("/admin/sellers", body ?? {}, {
      contextModule: "admin",
    }),
  /** Delete seller (admin). DELETE /food/admin/sellers/:id */
  deleteSeller: (id) =>
    apiClient.delete(`/admin/sellers/${String(id)}`, {
      contextModule: "admin",
    }),

  /** List delivery zones. Query: limit, page, isActive, search */
  getZones: (params = {}) =>
    apiClient.get("/admin/zones", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Seller report (admin). */
  getSellerReport: (params = {}) =>
    apiClient.get("/admin/reports/sellers", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTransactionReport: (params = {}) =>
    apiClient.get("/admin/reports/transactions", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Delivery SLA / commission / coin liability reports; params: from, to, fulfilmentMode. */
  getDeliverySlaReport: (params = {}) =>
    apiClient.get("/admin/reports/delivery-sla", { params, contextModule: "admin" }),
  exportDeliverySlaReport: (params = {}) =>
    apiClient.get("/admin/reports/delivery-sla/export", { params, responseType: "blob", contextModule: "admin" }),
  getCommissionReport: (params = {}) =>
    apiClient.get("/admin/reports/commission", { params, contextModule: "admin" }),
  /** Courier (standard) orders with their shipment. */
  getShipments: (params = {}) =>
    apiClient.get("/admin/shipments", { params, contextModule: "admin" }),
  trackShipmentAdmin: (orderId) =>
    apiClient.get(`/admin/shipments/${String(orderId)}/tracking`, { contextModule: "admin" }),
  bookShipmentAdmin: (orderId) =>
    apiClient.post(`/admin/shipments/${String(orderId)}/book`, {}, { contextModule: "admin" }),
  cancelShipmentAdmin: (orderId, reason = "") =>
    apiClient.post(`/admin/shipments/${String(orderId)}/cancel`, { reason }, { contextModule: "admin" }),
  /** NDR queue (failed delivery attempts); params.state: pending | actioned | all. */
  getNdrQueue: (params = {}) =>
    apiClient.get("/admin/shipments/ndr", { params, contextModule: "admin" }),
  /** body: { action: "reattempt" | "rto" | "contact", address1?, address2?, phone?, deferredDate?, comments?, message? } */
  ndrActionAdmin: (orderId, body = {}) =>
    apiClient.post(`/admin/shipments/ndr/${String(orderId)}/action`, body, { contextModule: "admin" }),
  /** RTO queue; params.state: open | received | all. */
  getRtoQueue: (params = {}) =>
    apiClient.get("/admin/shipments/rto", { params, contextModule: "admin" }),
  /** Marks an RTO received at the seller: restocks once, refunds a prepaid order once. */
  receiveRtoAdmin: (orderId, body = {}) =>
    apiClient.post(`/admin/shipments/rto/${String(orderId)}/receive`, body, { contextModule: "admin" }),
  getCodRemittances: (params = {}) =>
    apiClient.get("/admin/cod-remittances", { params, contextModule: "admin" }),
  getCodRemittanceById: (id) =>
    apiClient.get(`/admin/cod-remittances/${String(id)}`, { contextModule: "admin" }),
  getCodSummary: () =>
    apiClient.get("/admin/cod-remittances/summary", { contextModule: "admin" }),
  getCodOutstanding: (params = {}) =>
    apiClient.get("/admin/cod-remittances/outstanding", { params, contextModule: "admin" }),
  /** body: { lines: [{ awb, amount }] } or { csv } -> matched lines, nothing saved. */
  previewCodRemittance: (body = {}) =>
    apiClient.post("/admin/cod-remittances/preview", body, { contextModule: "admin" }),
  /** body: { courier, reference, date, note?, lines | csv } */
  createCodRemittance: (body = {}) =>
    apiClient.post("/admin/cod-remittances", body, { contextModule: "admin" }),
  getCheckoutsAdmin: (params = {}) =>
    apiClient.get("/admin/checkouts", { params, contextModule: "admin" }),
  getCheckoutAdmin: (checkoutId) =>
    apiClient.get(`/admin/checkouts/${encodeURIComponent(String(checkoutId))}`, { contextModule: "admin" }),
  getReturns: (params = {}) =>
    apiClient.get("/admin/returns", { params, contextModule: "admin" }),
  getReturnById: (id) =>
    apiClient.get(`/admin/returns/${String(id)}`, { contextModule: "admin" }),
  getReturnSettings: () =>
    apiClient.get("/admin/returns/settings", { contextModule: "admin" }),
  updateReturnSettings: (body) =>
    apiClient.patch("/admin/returns/settings", body ?? {}, { contextModule: "admin" }),
  approveReturn: (id, body = {}) =>
    apiClient.post(`/admin/returns/${String(id)}/approve`, body, { contextModule: "admin" }),
  rejectReturn: (id, reason) =>
    apiClient.post(`/admin/returns/${String(id)}/reject`, { reason }, { contextModule: "admin" }),
  /** Marks the items received and refunds them (once). */
  receiveReturn: (id, body = {}) =>
    apiClient.post(`/admin/returns/${String(id)}/receive`, body, { contextModule: "admin" }),
  exportCommissionReport: (params = {}) =>
    apiClient.get("/admin/reports/commission/export", { params, responseType: "blob", contextModule: "admin" }),
  getCoinLiabilityReport: (params = {}) =>
    apiClient.get("/admin/reports/coin-liability", { params, contextModule: "admin" }),
  exportCoinLiabilityReport: (params = {}) =>
    apiClient.get("/admin/reports/coin-liability/export", { params, responseType: "blob", contextModule: "admin" }),
  getTaxReport: (params = {}) =>
    apiClient.get("/admin/reports/tax", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReportDetail: (id, params = {}) =>
    apiClient.get(`/admin/reports/tax/${id}`, {
      params,
      contextModule: "admin",
    }),
  /** Get single zone by id */
  getZoneById: (id) =>
    apiClient.get(`/admin/zones/${id}`, { contextModule: "admin" }),
  /** Create zone. Body: name, zoneName?, country?, unit?, coordinates, isActive? */
  createZone: (body) =>
    apiClient.post("/admin/zones", body ?? {}, { contextModule: "admin" }),
  /** Update zone. Body: name?, zoneName?, country?, unit?, coordinates?, isActive? */
  updateZone: (id, body) =>
    apiClient.patch(`/admin/zones/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Delete zone */
  deleteZone: (id) =>
    apiClient.delete(`/admin/zones/${id}`, { contextModule: "admin" }),

  /** Feedback Experience (admin) */
  getFeedbackExperiences: (params = {}) =>
    apiClient.get(API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE, {
      params,
      contextModule: "admin",
    }),
  deleteFeedbackExperience: (id) =>
    apiClient.delete(`${API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE}/${id}`, {
      contextModule: "admin",
    }),

  /** Public env variables (safe subset). Used for runtime keys like Google Maps. */
  // getPublicEnvVariables removed: rely on import.meta.env instead.

  /** Public categories (user app) - zone-aware */
  getPublicCategories: (params = {}, config = {}) =>
    publicGetOnce("/catalog/categories", {
      params: params ?? {},
      ...config,
    }),

  /** Offers & Coupons (admin) */
  getAllOffers: (params = {}) =>
    apiClient.get("/admin/offers", { params, contextModule: "admin" }),
  createAdminOffer: (body) =>
    apiClient.post("/admin/offers", body ?? {}, {
      contextModule: "admin",
    }),
  updateAdminOfferCartVisibility: (offerId, itemId, showInCart) =>
    apiClient.patch(
      `/admin/offers/${String(offerId)}/cart-visibility`,
      { itemId: String(itemId), showInCart: Boolean(showInCart) },
      { contextModule: "admin" },
    ),
  deleteAdminOffer: (offerId) =>
    apiClient.delete(`/admin/offers/${String(offerId)}`, {
      contextModule: "admin",
    }),

  /** Delivery Partner Bonus (admin) */
  getDeliveryPartnerBonusTransactions: (params = {}) =>
    apiClient.get("/admin/delivery/bonus-transactions", {
      params,
      contextModule: "admin",
    }),
  /** Delivery Earnings (admin) */
  getDeliveryEarnings: (params = {}) =>
    apiClient.get("/admin/delivery/earnings", {
      params,
      contextModule: "admin",
    }),
  addDeliveryPartnerBonus: (deliveryPartnerId, amount, reference = "") =>
    apiClient.post(
      "/admin/delivery/bonus",
      {
        deliveryPartnerId: String(deliveryPartnerId),
        amount: Number(amount),
        reference: String(reference || ""),
      },
      { contextModule: "admin" },
    ),

  /** Earning Addon Offers (admin) */
  getEarningAddons: (params = {}) =>
    apiClient.get("/admin/delivery/earning-addons", {
      params,
      contextModule: "admin",
    }),
  createEarningAddon: (body) =>
    apiClient.post("/admin/delivery/earning-addons", body ?? {}, {
      contextModule: "admin",
    }),
  updateEarningAddon: (id, body) =>
    apiClient.patch(
      `/admin/delivery/earning-addons/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteEarningAddon: (id) =>
    apiClient.delete(`/admin/delivery/earning-addons/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleEarningAddonStatus: (id, status) =>
    apiClient.patch(
      `/admin/delivery/earning-addons/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),

  /** Earning Addon History (admin) */
  getEarningAddonHistory: (params = {}) =>
    apiClient.get("/admin/delivery/earning-addon-history", {
      params,
      contextModule: "admin",
    }),
  creditEarningToWallet: (historyId, notes = "") =>
    apiClient.post(
      `/admin/delivery/earning-addon-history/${String(historyId)}/credit`,
      { notes: String(notes || "") },
      { contextModule: "admin" },
    ),
  cancelEarningAddonHistory: (historyId, reason = "") =>
    apiClient.post(
      `/admin/delivery/earning-addon-history/${String(historyId)}/cancel`,
      { reason: String(reason || "") },
      { contextModule: "admin" },
    ),
  checkEarningAddonCompletions: (deliveryPartnerId, force = false) =>
    apiClient.post(
      "/admin/delivery/earning-addon-completions/check",
      { deliveryPartnerId: String(deliveryPartnerId), force: Boolean(force) },
      { contextModule: "admin" },
    ),
  getDeliveryWallets: (params = {}) =>
    apiClient.get("/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/admin/delivery/withdrawals/${String(id)}`, body, {
      contextModule: "admin",
    }),
  getCashLimitSettlements: (params = {}) =>
    apiClient.get("/admin/delivery/cash-limit-settlements", {
      params,
      contextModule: "admin",
    }),

  /** Seller Commission (admin) */
  getSellerCommissionBootstrap: () =>
    apiClient.get("/admin/seller-commissions/bootstrap", {
      contextModule: "admin",
    }),
  getSellerCommissions: (params = {}) =>
    apiClient.get("/admin/seller-commissions", {
      params,
      contextModule: "admin",
    }),
  getSellerCommissionById: (id) =>
    apiClient.get(`/admin/seller-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  createSellerCommission: (body) =>
    apiClient.post("/admin/seller-commissions", body ?? {}, {
      contextModule: "admin",
    }),
  updateSellerCommission: (id, body) =>
    apiClient.patch(
      `/admin/seller-commissions/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteSellerCommission: (id) =>
    apiClient.delete(`/admin/seller-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleSellerCommissionStatus: (id) =>
    apiClient.patch(
      `/admin/seller-commissions/${String(id)}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Backward-compatible alias used in UI */
  getApprovedSellers: (params = {}) =>
    apiClient.get("/admin/sellers", {
      params: { status: "approved", ...params },
      contextModule: "admin",
    }),

  /** Delivery Boy Commission Rules (admin) */
  getCommissionRules: () =>
    apiClient.get("/admin/delivery/commission-rules", {
      contextModule: "admin",
    }),
  createCommissionRule: (body) =>
    apiClient.post("/admin/delivery/commission-rules", body ?? {}, {
      contextModule: "admin",
    }),
  updateCommissionRule: (id, body) =>
    apiClient.patch(
      `/admin/delivery/commission-rules/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteCommissionRule: (id) =>
    apiClient.delete(`/admin/delivery/commission-rules/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleCommissionRuleStatus: (id, status) =>
    apiClient.patch(
      `/admin/delivery/commission-rules/${String(id)}/status`,
      { status: Boolean(status) },
      { contextModule: "admin" },
    ),

  /** Fee Settings (admin) */
  getFeeSettings: () =>
    apiClient.get("/admin/fee-settings", { contextModule: "admin" }),
  getPublicFeeSettings: (config = {}) =>
    publicConfigGetOnce("/settings/fees", config),
  createOrUpdateFeeSettings: (body) =>
    apiClient.put("/admin/fee-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Referral Settings (admin) */
  getReferralSettings: () =>
    apiClient.get("/admin/referral-settings", { contextModule: "admin" }),
  createOrUpdateReferralSettings: (body) =>
    apiClient.put("/admin/referral-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Safety / Emergency Reports (admin) */
  getSafetyEmergencyReports: (params) =>
    apiClient.get("/admin/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateSafetyEmergencyStatus: (id, status) =>
    apiClient.put(
      `/admin/safety-emergency-reports/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),
  updateSafetyEmergencyPriority: (id, priority) =>
    apiClient.put(
      `/admin/safety-emergency-reports/${String(id)}/priority`,
      { priority: String(priority) },
      { contextModule: "admin" },
    ),
  deleteSafetyEmergencyReport: (id) =>
    apiClient.delete(`/admin/safety-emergency-reports/${String(id)}`, {
      contextModule: "admin",
    }),

  /** Delivery Cash Limit (admin) */
  getDeliveryCashLimit: () =>
    apiClient.get("/admin/delivery-cash-limit", {
      contextModule: "admin",
    }),
  updateDeliveryCashLimit: (body) =>
    apiClient.patch("/admin/delivery-cash-limit", body ?? {}, {
      contextModule: "admin",
    }),

  /** Delivery Emergency Help (admin) */
  getEmergencyHelp: () =>
    apiClient.get("/admin/delivery-emergency-help", {
      contextModule: "admin",
    }),
  createOrUpdateEmergencyHelp: (body) =>
    apiClient.put("/admin/delivery-emergency-help", body ?? {}, {
      contextModule: "admin",
    }),

  /** Business Settings (admin) */
  getBusinessSettings: () =>
    apiClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, {
      contextModule: "admin",
    }),
  getPowerScanningSettings: () =>
    apiClient.get("/admin/power-scanning", {
      contextModule: "admin",
    }),
  getPublicPowerScanningSettings: (config = {}) =>
    publicConfigGetOnce("/settings/power-scanning", config),
  updatePowerScanningSettings: (body = {}) =>
    apiClient.patch("/admin/power-scanning", body ?? {}, {
      contextModule: "admin",
    }),
  updateBusinessSettings: (data, files = {}) => {
    const formData = new FormData();
    // Add JSON data
    formData.append("data", JSON.stringify(data));
    // Add files
    if (files.logo) formData.append("logo", files.logo);
    if (files.favicon) formData.append("favicon", files.favicon);
    if (files.sellerLogo) formData.append("sellerLogo", files.sellerLogo);
    if (files.sellerFavicon) formData.append("sellerFavicon", files.sellerFavicon);
    if (files.deliveryLogo) formData.append("deliveryLogo", files.deliveryLogo);
    if (files.deliveryFavicon) formData.append("deliveryFavicon", files.deliveryFavicon);

    return apiClient.patch(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "admin",
    });
  },

  /** Quick phone home layout (QUICK_MOBILE_SPEC.md §3); no zoneId = the global layout. */
  getQuickHomeLayout: (zoneId) =>
    apiClient.get("/admin/quick-home-layout", { params: zoneId ? { zoneId } : {}, contextModule: "admin" }),
  saveQuickHomeLayout: (zoneId, layout) =>
    apiClient.put("/admin/quick-home-layout", layout, { params: zoneId ? { zoneId } : {}, contextModule: "admin" }),
  resetQuickHomeLayout: (zoneId) =>
    apiClient.delete("/admin/quick-home-layout", { params: { zoneId }, contextModule: "admin" }),
};

/** Seller API - OTP login via new backend; no email/password. */
export const sellerAPI = {
  createUnregisteredSeller: (data) =>
    apiClient.post("/seller/unregistered", data),
  deleteAccount: () => apiClient.delete('/seller/current', { contextModule: 'seller' }),
  /** GET /seller/reviews { productId, rating, replied: "true"|"false", status, page, limit } */
  getProductReviews: (params = {}) =>
    apiClient.get('/seller/reviews', { params, contextModule: 'seller' }),
  /** POST /seller/reviews/:id/reply { text } - once per review (409 after) */
  replyToProductReview: (reviewId, text) =>
    apiClient.post(`/seller/reviews/${reviewId}/reply`, { text }, { contextModule: 'seller' }),
  reportProductReview: (reviewId, reason) =>
    apiClient.post(`/seller/reviews/${reviewId}/report`, { reason }, { contextModule: 'seller' }),
  getWallet: () => apiClient.get('/seller/finance', { contextModule: 'seller' }),
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestSellerOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, _email, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifySellerOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => authService.getMe("seller"),
  /** Seller dashboard: always fetch fresh profile data. */
  getCurrentSeller: () =>
    apiClient.get("/seller/current", { contextModule: "seller" }),
  /** Sends a rejected application back to the admin for review. */
  reverify: () =>
    apiClient.post("/seller/reverify", {}, { contextModule: "seller" }),
  /** Finance dashboard for `hub-finance`. */
  getFinance: (params = {}) =>
    apiClient.get("/seller/finance", {
      contextModule: "seller",
      params: params || {},
    }),
  /** Fetch seller by owner (stub for missing backend endpoint). */
  getSellerByOwner: () =>
    Promise.resolve({
      data: {
        success: true,
        data: {
          seller: {
            name: "Your Seller",
            sellerId: "REST000001",
            address: "Your address",
          },
        },
      },
    }),
  /** Submit a real withdrawal request to the backend. */
  createWithdrawalRequest: (amount) =>
    apiClient.post("/seller/withdraw", { amount: Number(amount) }, {
      contextModule: "seller"
    }),
  getWithdrawalHistory: () =>
    apiClient.get("/seller/withdrawals", {
      contextModule: "seller"
    }),
  /** Calendar-month postpaid subscription billing */
  getSubscriptionOverview: () =>
    apiClient.get("/seller/subscription/overview", {
      contextModule: "seller"
    }),
  getSubscriptionInvoices: (params = {}) =>
    apiClient.get("/seller/subscription/invoices", {
      params,
      contextModule: "seller"
    }),
  getSubscriptionInvoice: (invoiceId) =>
    apiClient.get(`/seller/subscription/invoices/${String(invoiceId)}`, {
      contextModule: "seller"
    }),
  getSubscriptionTransactions: (params = {}) =>
    apiClient.get("/seller/subscription/transactions", {
      params,
      contextModule: "seller"
    }),
  /** Update seller profile fields (name/location/menuImages). */
  updateProfile: (body) =>
    apiClient
      .patch("/seller/profile", body ?? {}, {
        contextModule: "seller",
      })
      .then((res) => res),
  /** PATCH /food/seller/availability. Body: { isAcceptingOrders: boolean } */
  updateAcceptingOrders: (isAcceptingOrders) =>
    apiClient
      .patch(
        "/seller/availability",
        { isAcceptingOrders: Boolean(isAcceptingOrders) },
        { contextModule: "seller" },
      )
      .then((res) => res),
  /** Upload and set seller profile image (multipart). Field name: file */
  uploadProfileImage: async (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const uploadFile = await toUploadReadyImage(file);
    const formData = new FormData();
    formData.append("file", uploadFile);
    const response = await apiClient.post("/seller/profile/profile-image", formData, {
      contextModule: "seller",
    });
    const profileImage = response?.data?.data?.profileImage;
    if (profileImage?.url) {
      profileImage.url = resolveMediaUrl(profileImage.url);
    }
    return response;
  },
  /** Upload a menu/cover image (multipart). Does not auto-attach; use updateProfile(menuImages) after. */
  uploadMenuImage: async (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const uploadFile = await toUploadReadyImage(file);
    const formData = new FormData();
    formData.append("file", uploadFile);
    const response = await apiClient.post("/seller/profile/menu-image", formData, {
      contextModule: "seller",
    });
    const menuImage = response?.data?.data?.menuImage;
    if (menuImage?.url) {
      menuImage.url = resolveMediaUrl(menuImage.url);
    }
    return response;
  },
  uploadCoverImages: async (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const convertedFiles = await toUploadReadyImages(normalizedFiles);
    const formData = new FormData();
    convertedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/seller/profile/cover-images", formData, {
      contextModule: "seller",
    });
  },
  uploadMenuImages: async (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const convertedFiles = await toUploadReadyImages(normalizedFiles);
    const formData = new FormData();
    convertedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/seller/profile/menu-images", formData, {
      contextModule: "seller",
    });
  },
  /** My Offers (Coupons) */
  listMyOffers: () => apiClient.get("/seller/my-offers", { contextModule: "seller" }),
  createMyOffer: (body) => apiClient.post("/seller/my-offers", body, { contextModule: "seller" }),
  deleteMyOffer: (id) => apiClient.delete(`/seller/my-offers/${id}`, { contextModule: "seller" }),
  updateMyOfferStatus: (id, status) => apiClient.patch(`/seller/my-offers/${id}/status`, { status }, { contextModule: "seller" }),
  /** Public Offers for users (global/selected seller) */
  getPublicOffers: (params = {}) => apiClient.get("/catalog/offers", { params }),
  /** Backward-compat helper used by Cart: returns coupons array for an item by adapting public offers */
  getCouponsByItemIdPublic: (sellerId, _itemId, subtotal) =>
    apiClient.get("/catalog/offers", { params: { sellerId, subtotal } }).then((res) => {
      const list = res?.data?.data?.allOffers || res?.data?.allOffers || [];
      const now = Date.now();
      const coupons = list
        .filter((o) => {
          // Guard: respect selected seller scope
          if (String(o?.sellerScope) === "selected") {
            if (!sellerId) return false;
            const sellerIds = Array.isArray(o.sellerIds) && o.sellerIds.length > 0
              ? o.sellerIds
              : [o.sellerId].filter(Boolean);
            return sellerIds.some((id) => String(id) === String(sellerId || ""));
          }
          return true;
        })
        .map((o) => {
          const isPct = o.discountType === "percentage";
          const discountVal = Number(o.discountValue || 0);
          return {
            couponCode: o.couponCode,
            discountType: o.discountType,
            discountPercentage: isPct ? discountVal : 0,
            discountValue: discountVal,
            // For backward compat with Cart.jsx mapping (original - discounted = savings)
            originalPrice: isPct ? 0 : discountVal,
            discountedPrice: 0,
            minOrderValue: Number(o.minOrderValue || 0),
            minOrder: Number(o.minOrderValue || 0),
            maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
            customerGroup: o.customerScope || "all",
            isGlobalCoupon: o.sellerScope === "all",
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            _ts: now,
          };
        });
      return { data: { success: true, data: { coupons } } };
    }),
  /** Categories (seller dashboard) */
  getCategories: (params = {}) =>
    // Compact payload for item creation forms (id + name only).
    apiClient.get("/seller/categories", {
      params: { compact: true, limit: 1000, ...params },
      contextModule: "seller",
    }),
  // For MenuCategoriesPage compatibility
  getAllCategories: (params = {}) =>
    apiClient.get("/seller/categories", {
      params: {
        includeInactive: true,
        withCounts: true,
        limit: 1000,
        ...params,
      },
      contextModule: "seller",
    }),
  createCategory: (body) =>
    apiClient.post("/seller/categories", body ?? {}, {
      contextModule: "seller",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/seller/categories/${String(id)}`, body ?? {}, {
      contextModule: "seller",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/seller/categories/${String(id)}`, {
      contextModule: "seller",
    }),
  /** Menu (seller dashboard) */
  getMenu: (params = {}) =>
    apiClient.get("/seller/menu", {
      params,
      contextModule: "seller",
    }),
  /** Orders (seller dashboard) */
  getOrders: (params = {}) =>
    apiClient.get("/seller/orders", {
      params: { limit: 50, page: 1, ...params },
      contextModule: "seller",
    }),
  getSubscriptionSettings: () =>
    apiClient.get("/settings/seller-subscription", {
      contextModule: "seller",
    }),
  getFeatureSettingsPublic: (config = {}) =>
    publicConfigGetOnce("/settings/features", {
      contextModule: "seller",
      ...config,
    }),
  getOrderById: (orderId) =>
    apiClient.get(`/seller/orders/${String(orderId)}`, {
      contextModule: "seller",
    }),
  saveFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "seller" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "seller",
      },
    );
  },
  /** Outlet timings (seller dashboard) */
  getOutletTimings: () =>
    apiClient.get("/seller/outlet-timings", {
      contextModule: "seller",
    }),
  saveOutletTimings: (outletTimings) =>
    apiClient.put(
      "/seller/outlet-timings",
      { outletTimings: outletTimings || {} },
      { contextModule: "seller" },
    ),
  /** Products (seller) - stored in products collection */
  createProduct: (body) =>
    apiClient.post("/seller/products", body ?? {}, {
      contextModule: "seller",
    }),
  updateProduct: (id, body) =>
    apiClient.patch(`/seller/products/${String(id)}`, body ?? {}, {
      contextModule: "seller",
    }),
  /** Bulk stock: up to 500 `{ itemId, channel: 'quick'|'shop', qty, variantId? }` (absolute count for that channel). */
  updateStock: (items) =>
    apiClient.patch("/seller/products/stock", { items }, { contextModule: "seller" }),
  /** Low-stock rows; optional channel 'quick'|'shop'. Each row carries its channel. */
  getLowStock: (channel) =>
    apiClient.get("/seller/products/low-stock", {
      params: channel ? { channel } : undefined,
      contextModule: "seller",
    }),
  /** POST /seller/channels/:channel/apply — none/rejected -> pending; 400 says what's missing. */
  applyForChannel: (channel) =>
    apiClient.post(`/seller/channels/${encodeURIComponent(String(channel))}/apply`, {}, {
      contextModule: "seller",
    }),
  bulkUploadTemplate: () =>
    apiClient.get("/seller/bulk-upload/template", {
      responseType: 'blob',
      contextModule: "seller"
    }),
  bulkUpload: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/seller/bulk-upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "seller",
    });
  },
  /** Orders (seller dashboard) */
  getOrders: (() => {
    // Single-flight de-dupe to avoid duplicate GETs in React StrictMode / double-mount.
    let inFlight = null;
    let inFlightKey = "";
    let cache = null;
    let cacheKey = "";
    let cacheAt = 0;
    const CACHE_MS = 800;

    const buildKey = (p = {}) => JSON.stringify({ limit: 50, page: 1, ...p });

    return (params = {}) => {
      const key = buildKey(params);
      const now = Date.now();

      if (cache && cacheKey === key && now - cacheAt < CACHE_MS) {
        return Promise.resolve(cache);
      }

      if (inFlight && inFlightKey === key) return inFlight;

      inFlightKey = key;
      inFlight = apiClient
        .get("/seller/orders", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "seller",
        })
        .then((res) => {
          // Backend paginated shape: { data: { data: [...], meta: {...} } }
          // Normalize to { data: { data: { orders: [...], meta } } } for seller UI pages.
          const payload = res?.data?.data || {};
          const rowsRaw = Array.isArray(payload.data) ? payload.data : [];

          // Normalize backend order fields to match existing seller UI expectations.
          // UI historically uses: order.status, order.address, order.total, order.paymentMethod
          const normalizeStatus = (s) => {
            const v = String(s || "").toLowerCase();
            // Backend: created -> treat as confirmed/new in UI
            if (v === "created") return "confirmed";
            // Backend: ready_for_pickup -> ready
            if (v === "ready_for_pickup") return "ready";
            // Backend: picked_up -> out_for_delivery (seller handed over)
            if (v === "picked_up") return "out_for_delivery";
            if (v.includes("cancel")) return "cancelled";
            return v || "confirmed";
          };

          const rows = rowsRaw.map((o) => {
            const status = normalizeStatus(o.orderStatus || o.status);
            const address = o.deliveryAddress || o.address;
            const total = o.pricing?.total ?? o.total ?? 0;
            const paymentMethod = o.payment?.method || o.paymentMethod || null;
            return { ...o, status, address, total, paymentMethod };
          });
          const meta = payload.meta || {};
          const normalized = {
            ...res,
            data: {
              ...res.data,
              data: { orders: rows, meta },
            },
          };

          cache = normalized;
          cacheKey = key;
          cacheAt = Date.now();
          return normalized;
        })
        .finally(() => {
          inFlight = null;
          inFlightKey = "";
        });

      return inFlight;
    };
  })(),
  updateOrderStatus: (orderId, body) => {
    const raw = body ?? {};
    const outgoing = { ...raw };

    // Translate UI-friendly statuses to backend enum values.
    const normalizeOutgoingStatus = (s) => {
      const v = String(s || "")
        .toLowerCase()
        .trim();
      if (!v) return v;
      if (v === "ready") return "ready_for_pickup";
      if (v === "out_for_delivery") return "picked_up";
      if (v === "cancelled") return "cancelled_by_seller";
      return v;
    };

    if (outgoing.orderStatus) {
      outgoing.orderStatus = normalizeOutgoingStatus(outgoing.orderStatus);
    }

    return apiClient.patch(
      `/seller/orders/${String(orderId)}/status`,
      outgoing,
      { contextModule: "seller" },
    );
  },
  /**
   * Accept an incoming order (seller).
   * UI expects this to move order into "preparing" bucket.
   * Backend supports PATCH /food/seller/orders/:orderId/status with { orderStatus }.
   */
  acceptOrder: (orderId, _prepTimeMins = null) =>
    sellerAPI.updateOrderStatus(orderId, { orderStatus: "preparing" }),
  /**
   * Reject/cancel order by seller.
   * Backend orderStatus enum: cancelled_by_seller.
   */
  rejectOrder: (orderId, reason = "") =>
    sellerAPI.updateOrderStatus(orderId, {
      orderStatus: "cancelled_by_seller",
      note: reason,
    }),
  /** Mark order ready (seller handoff). */
  markOrderReady: (orderId) =>
    sellerAPI.updateOrderStatus(orderId, {
      orderStatus: "ready_for_pickup",
    }),
  /** Generate courier shipping label and AWB for standard orders */
  createOrderShipment: (orderId) =>
    apiClient.post(`/seller/orders/${String(orderId)}/shipment`, {}, {
      contextModule: "seller",
    }),
  /** Track courier shipment events */
  trackOrderShipment: (orderId) =>
    apiClient.get(`/seller/orders/${String(orderId)}/shipment/track`, {
      contextModule: "seller",
    }),
  /** Customer returns on this store's orders (read-only). */
  getReturns: (params = {}) =>
    apiClient.get("/seller/returns", { params, contextModule: "seller" }),
  /**
   * Get a single order by id for seller screens.
   * Prefer direct endpoint; fallback to list+filter for backward compatibility.
   */
  getOrderById: async (orderId) => {
    return await apiClient.get(`/seller/orders/${String(orderId)}`, {
      contextModule: "seller",
    });
  },
  logout: async (refreshToken, fcmTokenOverride = null, platformOverride = null) => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("seller_refreshToken")
        : null);
    let fcmToken = fcmTokenOverride;
    let platform = platformOverride || "web";
    if (!fcmToken) {
      const resolved = await resolveLogoutFcmToken("seller");
      fcmToken = resolved.token;
      platform = resolved.platform;
    }
    return authService.logout(token, fcmToken, platform);
  },
  /** Backend has no email/password login; use phone OTP only. */
  login: (_email, _password) =>
    Promise.reject(new Error("Please use phone number and OTP to sign in.")),
  /**
   * Register a seller (multipart FormData).
   * Backend: POST /v1/food/seller/register (path relative to baseURL /api/v1)
   */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.post("/seller/register", formData);
  },
  createOnboardingFeeOrder: (ownerPhone) =>
    apiClient.post("/seller/onboarding-fee/order", { ownerPhone }),
  /** Upload a single attachment for background onboarding uploads */
  uploadAttachment: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.post("/seller/upload-attachment", formData);
  },
  /** Public: list approved sellers for user app */
  getSellers: (params = {}, config = {}) =>
    getPublicSellersOnce(params, config),
  /** Public: get single approved seller by id or slug */
  getSellerById: (id, config = {}) =>
    apiClient.get(`/catalog/stores/${String(id)}`, { ...config }),
  /** Public: get approved menu by seller id or slug */
  getMenuBySellerId: (id, config = {}) =>
    getPublicSellerMenuOnce(id, config),
  /** Public: get outlet timings by seller id */
  getOutletTimingsBySellerId: (id, config = {}) =>
    getPublicSellerOutletTimingsOnce(id, config),
  /** Public: approved products for user category/search pages (zone + optional category slug) */
  getPublicProducts: (params = {}, config = {}) =>
    getPublicProductsOnce(params, config),
  getPublicOffers: (params = {}, config = {}) =>
    apiClient.get("/catalog/offers", { params, ...config }),
  /** Resend delivery notification (seller dashboard) */
  resendDeliveryNotification: (orderId) =>
    apiClient.post(`/seller/orders/${String(orderId)}/resend-notification`, {}, {
      contextModule: "seller",
    }),
  /** List seller complaints (for current seller dashboard) */
  getComplaints: (params = {}) =>
    apiClient.get("/seller/complaints", {
      params,
      contextModule: "seller",
    }),
  /** Seller support tickets */
  createSupportTicket: (body = {}) =>
    apiClient.post("/seller/support/tickets", body ?? {}, {
      contextModule: "seller",
    }),
  getSupportTickets: (params = {}) =>
    apiClient.get("/seller/support/tickets", {
      params,
      contextModule: "seller",
    }),
};

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function createInFlightCache({ ttlMs }) {
  const inFlight = new Map();
  const cached = new Map(); // key -> { t, v }

  const getCached = (key) => {
    const hit = cached.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      cached.delete(key);
      return null;
    }
    return hit.v;
  };

  const getOrCreate = (key, factory) => {
    const cachedValue = getCached(key);
    if (cachedValue) return Promise.resolve(cachedValue);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = Promise.resolve()
      .then(factory)
      .then((res) => {
        cached.set(key, { t: Date.now(), v: res });
        return res;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };

  const invalidate = () => {
    inFlight.clear();
    cached.clear();
  };

  return { getOrCreate, invalidate };
}

// Long-lived cache for public app config (banners, settings, fees) — shared across routes.
const PUBLIC_CONFIG_CACHE_TTL_MS = 15 * 60 * 1000;
const publicConfigCache = createInFlightCache({ ttlMs: PUBLIC_CONFIG_CACHE_TTL_MS });

export const invalidatePublicConfigCache = () => {
  publicConfigCache.invalidate();
};

export const publicConfigGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return apiClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }

  const key = `CONFIG:${safeUrl}:${stableStringify(keyParams)}`;
  return publicConfigCache.getOrCreate(key, () =>
    apiClient.get(safeUrl, { params, ...axiosConfig }),
  );
};

// Public user-app endpoints can be called by multiple components/effects on refresh (and React StrictMode in dev).
// A small in-flight + short TTL cache collapses duplicate requests without changing functionality.
const publicSellersCache = createInFlightCache({ ttlMs: 3000 });
const publicSellerMenuCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const publicSellerOutletTimingsCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const publicProductsCache = createInFlightCache({ ttlMs: 3 * 60 * 1000 });
const publicGenericGetCache = createInFlightCache({ ttlMs: 3000 });

export const publicGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return apiClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    // `_ts` is used as a cache-buster in some call sites; ignore it for dedupe purposes.
    delete keyParams._ts;
  }

  const key = `GET:${safeUrl}:${stableStringify(keyParams)}`;
  return publicGenericGetCache.getOrCreate(key, () =>
    apiClient.get(safeUrl, { params, ...axiosConfig }),
  );
};

const getPublicSellersOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  if (noCache) {
    return apiClient.get("/catalog/stores", {
      params: { limit: 1000, ...params },
      ...axiosConfig,
    });
  }
  const keyParams = { limit: 1000, ...params };
  // `_ts` is an explicit cache-buster in many call sites; ignore it for dedupe purposes.
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }
  const key = `sellers:${stableStringify(keyParams)}`;
  return publicSellersCache.getOrCreate(key, () =>
    apiClient.get("/catalog/stores", {
      params: { limit: 1000, ...params },
      ...axiosConfig,
    }),
  );
};

const getPublicSellerMenuOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(`/catalog/stores/${safeId}/products`, {
      ...axiosConfig,
    });
  }
  const key = `menu:${safeId}:${stableStringify(axiosConfig.params || {})}`;
  return publicSellerMenuCache.getOrCreate(key, () =>
    apiClient.get(`/catalog/stores/${safeId}/products`, {
      ...axiosConfig,
    }),
  );
};

const getPublicSellerOutletTimingsOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(
      `/catalog/stores/${safeId}/timings`,
      { ...axiosConfig },
    );
  }
  const key = `outletTimings:${safeId}`;
  return publicSellerOutletTimingsCache.getOrCreate(key, () =>
    apiClient.get(`/catalog/stores/${safeId}/timings`, {
      ...axiosConfig,
    }),
  );
};

const getPublicProductsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  const keyParams = { ...(params || {}) };
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
  }
  if (noCache) {
    return apiClient.get("/catalog/products", {
      params: keyParams,
      ...axiosConfig,
    });
  }
  const key = `publicProducts:${stableStringify(keyParams)}`;
  return publicProductsCache.getOrCreate(key, () =>
    apiClient.get("/catalog/products", {
      params: keyParams,
      ...axiosConfig,
    }),
  );
};

const toUploadReadyImage = async (file) => file;
const toUploadReadyImages = async (files = []) => Array.from(files || []).filter(Boolean);

/** Single in-flight + short cache for delivery /auth/me - one call per page load / refresh. */
let deliveryMeInFlight = null;
let deliveryMeCached = null;
let deliveryMeCacheTime = 0;
const DELIVERY_ME_CACHE_MS = 3000;

const getDeliveryMeOnce = () => {
  const now = Date.now();
  if (deliveryMeCached && now - deliveryMeCacheTime < DELIVERY_ME_CACHE_MS) {
    return Promise.resolve(deliveryMeCached);
  }
  if (!deliveryMeInFlight) {
    deliveryMeInFlight = authService
      .getMe("delivery")
      .then((res) => {
        deliveryMeCached = res;
        deliveryMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        deliveryMeInFlight = null;
      });
  }
  return deliveryMeInFlight;
};

/** Delivery API - OTP login + registration via new backend. */
export const deliveryAPI = {
  deleteAccount: () => apiClient.delete('/delivery/profile/account', { contextModule: 'delivery' }),
  getWallet: () => apiClient.get('/delivery/wallet', { contextModule: 'delivery' }),
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestDeliveryOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyDeliveryOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => getDeliveryMeOnce(),
  /** Get delivery profile (same as getMe under the hood; maps response to profile shape). */
  getProfile: () =>
    getDeliveryMeOnce().then((res) => ({
      ...res,
      data: {
        ...res.data,
        data: { profile: res.data?.data?.user ?? res.data?.data },
      },
    })),
  getReferralStats: () =>
    apiClient.get("/delivery/referrals/stats", {
      contextModule: "delivery",
    }),
  logout: async (refreshToken, fcmTokenOverride = null, platformOverride = null) => {
    deliveryMeCached = null;
    deliveryMeCacheTime = 0;
    try {
      localStorage.removeItem("app:isOnline");
    } catch (_) { }
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("delivery_refreshToken")
        : null);
    let fcmToken = fcmTokenOverride;
    let platform = platformOverride || "web";
    if (!fcmToken) {
      const resolved = await resolveLogoutFcmToken("delivery");
      fcmToken = resolved.token;
      platform = resolved.platform;
    }
    return authService.logout(token, fcmToken, platform);
  },
  /** POST /food/delivery/register - multipart FormData (new partner, no token). */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return apiClient.post("/delivery/register", formData);
  },
  /** GET /food/delivery/check-vehicle/:number - check if vehicle number is unique. */
  checkVehicleAvailability: (number) => apiClient.get(`/delivery/check-vehicle/${number}`),
  /** PATCH /food/delivery/profile - complete profile after OTP (Bearer token required). */
  completeProfile: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return apiClient.patch("/delivery/profile", formData, {
      contextModule: "delivery",
    });
  },
  /** PATCH /food/delivery/profile/details - JSON updates (vehicle number, etc). */
  updateProfileDetails: (payload) =>
    apiClient.patch("/delivery/profile/details", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile - multipart updates for photos/documents (uses same endpoint). */
  updateProfileMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.patch("/delivery/profile", formData, {
      contextModule: "delivery",
    });
  },
  /** POST /food/delivery/profile/photo-base64 - Flutter in-app camera base64 upload. */
  updateProfilePhotoBase64: (payload) =>
    apiClient.post("/delivery/profile/photo-base64", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile/bank-details - update bank details + PAN (JSON, Bearer required). */
  updateProfile: (payload) =>
    apiClient.patch("/delivery/profile/bank-details", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile/bank-details - multipart updates for bank details + UPI QR (FormData required). */
  updateBankDetailsMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.patch("/delivery/profile/bank-details", formData, {
      contextModule: "delivery",
    });
  },
  saveFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "delivery" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "delivery",
      },
    );
  },
  /** GET /food/delivery/support-tickets - list tickets for logged-in delivery partner. */
  getSupportTickets: () =>
    apiClient.get("/delivery/support-tickets", {
      contextModule: "delivery",
    }),
  /** POST /food/delivery/support-tickets - create ticket (body: subject, description, category?, priority?). */
  createSupportTicket: (body) =>
    apiClient.post("/delivery/support-tickets", body ?? {}, {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/support-tickets/:id - get one ticket (own only). */
  getSupportTicketById: (id) =>
    apiClient.get(`/delivery/support-tickets/${id}`, {
      contextModule: "delivery",
    }),
  getOrderEmergencyRequests: () =>
    apiClient.get("/delivery/order-emergency-requests", {
      contextModule: "delivery",
    }),
  createOrderEmergencyRequest: (body = {}) =>
    apiClient.post("/delivery/order-emergency-requests", body, {
      contextModule: "delivery",
    }),
  getOrderEmergencyRequestById: (id) =>
    apiClient.get(`/delivery/order-emergency-requests/${String(id)}`, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/availability - set online/offline (and optional lat/lng). */
  updateOnlineStatus: (isOnline) =>
    apiClient.patch(
      "/delivery/availability",
      { status: isOnline ? "online" : "offline" },
      { contextModule: "delivery" },
    ),
  updateLocation: (latitude, longitude, isOnline, extras = {}) =>
    apiClient.patch(
      "/delivery/availability",
      { status: isOnline ? "online" : "offline", latitude, longitude, ...extras },
      { contextModule: "delivery" },
    ),
  /** Orders */
  getOrders: (() => {
    // Collapse duplicate list fetches triggered by multiple effects + StrictMode.
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 2500;

    const stableKey = (p = {}) => {
      const safe = p && typeof p === "object" ? { ...p } : {};
      // Ensure stable ordering + defaults.
      const normalized = { limit: 50, page: 1, ...safe };
      // Remove cache-busters if any.
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, k) => {
            acc[k] = normalized[k];
            return acc;
          }, {}),
      );
    };

    return (params = {}) => {
      const key = stableKey(params);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get("/delivery/orders/available", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "delivery",
        })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  getOrderDetails: (() => {
    // Collapse duplicate calls coming from multiple effects (and React StrictMode in dev).
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 1200;

    const isProbablyOrderIdentity = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      // Mongo ObjectId
      return /^[a-f0-9]{24}$/i.test(raw);
    };

    return (orderId) => {
      const key = String(orderId || "").trim();
      if (!isProbablyOrderIdentity(key)) {
        return Promise.resolve({
          data: { success: false, message: "Invalid order id", data: null },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        });
      }

      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get(`/delivery/orders/${key}`, { contextModule: "delivery" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  /** GET /food/delivery/current - fallback for some UI hooks */
  getCurrentDelivery: () => apiClient.get("/delivery/orders/current", { contextModule: "delivery" }),
  acceptOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/delivery/orders/${String(orderId)}/accept`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  rejectOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/delivery/orders/${String(orderId)}/reject`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /**
   * PATCH /food/delivery/orders/:orderId/reached-pickup
   * Marks "reached pickup" (arrival at seller) in backend order deliveryState.
   */
  confirmReachedPickup: (orderId) =>
    apiClient.patch(
      `/delivery/orders/${String(orderId)}/reached-pickup`,
      {},
      { contextModule: "delivery" },
    ),
  /**
   * Confirm order ID and upload bill image (Picked Up slide).
   * Backend endpoint: PATCH /food/delivery/orders/:id/confirm-pickup
   */
  confirmOrderId: (orderId, confirmedOrderId, location = {}, data = {}) =>
    apiClient.patch(
      `/delivery/orders/${String(orderId)}/confirm-pickup`,
      {
        confirmedOrderId,
        latitude: location.lat,
        longitude: location.lng,
        billImageUrl: data.billImageUrl,
      },
      {
        contextModule: "delivery",
      },
    ),
  confirmReachedDrop: (orderId) =>
    apiClient.patch(
      `/delivery/orders/${String(orderId)}/reached-drop`,
      {},
      {
        contextModule: "delivery",
      },
    ),
  verifyDropOtp: (orderId, otp) =>
    apiClient.post(
      `/delivery/orders/${String(orderId)}/verify-drop-otp`,
      { otp: String(otp) },
      {
        contextModule: "delivery",
      },
    ),
  /** POST /food/delivery/orders/:orderId/collect/qr - create Razorpay payment link (COD collection) */
  createCollectQr: (orderId, body = {}) =>
    apiClient.post(
      `/delivery/orders/${String(orderId)}/collect/qr`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** GET /food/delivery/orders/:orderId/payment-status - check COD/QR payment status */
  getPaymentStatus: (orderId) =>
    apiClient.get(`/delivery/orders/${String(orderId)}/payment-status`, {
      contextModule: "delivery",
    }),

  switchToCash: (orderId) =>
    apiClient.post(`/delivery/orders/${String(orderId)}/collect/cash`, {}, {
      contextModule: "delivery",
    }),
  completeDelivery: (orderId, body = {}) => {

    // Backward-compatible: older UI calls completeDelivery(orderId, rating, review)
    // where rating is a number (sent as raw JSON like "3"). Normalize to an object.
    let payload = body ?? {};
    if (
      typeof payload === "number" ||
      typeof payload === "string" ||
      payload == null
    ) {
      payload = { rating: payload == null ? null : Number(payload) };
    }
    return apiClient.patch(
      `/delivery/orders/${String(orderId)}/complete`,
      payload,
      {
        contextModule: "delivery",
      },
    );
  },
  updateOrderStatus: (orderId, body = {}) =>
    apiClient.patch(
      `/delivery/orders/${String(orderId)}/status`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** Registration Re-verification */
  reverify: () =>
    apiClient.post(
      "/delivery/reverify",
      {},
      { contextModule: "delivery" },
    ),
  /** GET /food/delivery/wallet - wallet for Pocket/requests page (backend) */
  getWallet: () =>
    apiClient.get("/delivery/wallet", { contextModule: "delivery" }),
  /** GET /food/delivery/earnings - earnings summary for Pocket/requests page */
  getEarnings: (params) =>
    apiClient.get("/delivery/earnings", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** Earning Addons (Hotspots/Bonus) */
  getActiveEarningAddons: () =>
    apiClient.get("/delivery/earning-addons/active", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/trip-history - completed/cancelled/pending trips for delivery partner */
  getTripHistory: (params) =>
    apiClient.get("/delivery/trip-history", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/pocket-details - single-call week details (trips + transactions) */
  getPocketDetails: (params) =>
    apiClient.get("/delivery/pocket-details", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/emergency-help - admin-set emergency numbers for delivery partner */
  getEmergencyHelp: () =>
    apiClient.get("/delivery/emergency-help", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/cash-limit - admin-set cash limit for delivery partner */
  getCashLimit: () =>
    apiClient.get("/delivery/cash-limit", {
      contextModule: "delivery",
    }),
  createWithdrawalRequest: (body) =>
    apiClient.post("/delivery/wallet/withdraw", body ?? {}, {
      contextModule: "delivery"
    }),
  createDepositOrder: (amount) =>
    apiClient.post("/delivery/wallet/deposit/order", { amount }, {
      contextModule: "delivery"
    }),
  verifyDepositPayment: (body) =>
    apiClient.post("/delivery/wallet/deposit/verify", body ?? {}, {
      contextModule: "delivery"
    }),
  /** Wallet transactions - from wallet response (no separate backend endpoint) */
  getWalletTransactions: (params) =>
    apiClient
      .get("/delivery/wallet", {
        params: params ?? {},
        contextModule: "delivery",
      })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          data: {
            transactions: res?.data?.data?.wallet?.transactions ?? [],
          },
        },
      })),
  /** Zone discovery */
  getZonesInRadius: (lat, lng, radiusKm = 10) =>
    apiClient.get("/content/zones/nearby", {
      params: { lat, lng, radius: radiusKm },
      contextModule: "delivery",
    }),
};

export const userAPI = {
  /** `{ marketingPush }` — offers & promotions pushes (default on). */
  getNotificationPreferences: () =>
    apiClient.get("/user/notification-preferences", { contextModule: "user" }),
  updateNotificationPreferences: (body = {}) =>
    apiClient.patch("/user/notification-preferences", body, { contextModule: "user" }),
  /** Return eligibility, returnable lines and past returns for an order. */
  getOrderReturns: (orderId) =>
    apiClient.get(`/orders/${String(orderId)}/returns`, { contextModule: "user" }),
  /** `{ items: [{ itemId, variantId, quantity }], reason, comment, photos, refundTo: 'original'|'coins' }` */
  requestOrderReturn: (orderId, body) =>
    apiClient.post(`/orders/${String(orderId)}/returns`, body ?? {}, { contextModule: "user" }),
  deleteCurrentUserAccount: () =>
    apiClient
      .delete('/user/profile', { contextModule: 'user' })
      .finally(() => {
        clearUserMeCache();
      }),
  /** Get current user profile (Bearer USER). */
  getProfile: () =>
    getUserMeOnce().then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { ...res, data: { ...res.data, data: { user } } };
    }),
  /** PATCH /food/user/profile (Bearer USER) */
  updateProfile: (body) =>
    apiClient.patch("/user/profile", body ?? {}, {
      contextModule: "user",
    }),
  /** Upload and set user profile image (multipart). Field name: file */
  uploadProfileImage: async (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const uploadFile = await toUploadReadyImage(file);
    const formData = new FormData();
    formData.append("file", uploadFile);
    return apiClient.post("/user/profile/profile-image", formData, {
      contextModule: "user",
    });
  },
  /** GET /food/user/wallet (Bearer USER). Deduped + short-cached. */
  getWallet: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/user/wallet", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** GET /food/user/referrals/stats (Bearer USER) */
  getReferralStats: () =>
    apiClient.get("/user/referrals/stats", { contextModule: "user" }),
  /** GET /food/user/referrals/details (Bearer USER) */
  getReferralDetails: () =>
    apiClient.get("/user/referrals/details", { contextModule: "user" }),
  /** POST /food/user/wallet/topup/order (Bearer USER). Body: { amount } */
  createWalletTopupOrder: (amount) =>
    apiClient.post(
      "/user/wallet/topup/order",
      { amount: Number(amount) },
      { contextModule: "user" },
    ),
  /** POST /food/user/wallet/topup/verify (Bearer USER) */
  verifyWalletTopupPayment: (body) =>
    apiClient.post("/user/wallet/topup/verify", body ?? {}, {
      contextModule: "user",
    }),
  /** GET /food/user/addresses (Bearer USER). Deduped + short-cached. */
  getAddresses: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/user/addresses", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** POST /food/user/addresses (Bearer USER) */
  addAddress: (body) =>
    apiClient.post("/user/addresses", body ?? {}, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id (Bearer USER) */
  updateAddress: (id, body) =>
    apiClient.patch(`/user/addresses/${String(id)}`, body ?? {}, {
      contextModule: "user",
    }),
  /** DELETE /food/user/addresses/:id (Bearer USER) */
  deleteAddress: (id) =>
    apiClient.delete(`/user/addresses/${String(id)}`, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id/default (Bearer USER) */
  setDefaultAddress: (id) =>
    apiClient.patch(
      `/user/addresses/${String(id)}/default`,
      {},
      { contextModule: "user" },
    ),
  /** POST /food/user/safety-emergency-reports (Bearer USER) */
  createSafetyEmergencyReport: (message) =>
    apiClient.post(
      "/user/safety-emergency-reports",
      { message: String(message || "") },
      { contextModule: "user" },
    ),
  /** GET /food/user/safety-emergency-reports (Bearer USER) */
  getMySafetyEmergencyReports: (params) =>
    apiClient.get("/user/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "user",
    }),
  /** PUT /food/user/cart (Bearer USER) */
  /** body.mode: 'shop' | 'quick' - one server cart per storefront */
  syncCart: (body) =>
    apiClient.put("/user/cart", body ?? {}, { contextModule: "user" }),
  /** GET /user/cart?mode=shop|quick (Bearer USER) - saved cart, rechecked for price/stock in that channel */
  getCart: (mode = "shop") =>
    apiClient.get("/user/cart", { params: { mode: mode === "quick" ? "quick" : "shop" }, contextModule: "user" }),
  /** GET /user/saved-for-later?mode=shop|quick - parked cart lines, each with `available`/`reason` for the channel */
  getSavedForLater: (mode = "shop") =>
    apiClient.get("/user/saved-for-later", { params: { mode: mode === "quick" ? "quick" : "shop" }, contextModule: "user" }),
  /** POST /user/saved-for-later { mode, productId, variantId?, qty } - also drops the line from the stored cart */
  saveForLater: (body) =>
    apiClient.post("/user/saved-for-later", body ?? {}, { contextModule: "user" }),
  /** POST /user/saved-for-later/:id/move-to-cart - re-validated; returns `{ line, cart }` (400/409 with data.reason) */
  moveSavedToCart: (id) =>
    apiClient.post(`/user/saved-for-later/${id}/move-to-cart`, {}, { contextModule: "user" }),
  removeSavedForLater: (id) =>
    apiClient.delete(`/user/saved-for-later/${id}`, { contextModule: "user" }),
  /** GET /user/reviews/eligibility/:productId - `{ eligible, reason, variants, review }` */
  getReviewEligibility: (productId) =>
    apiClient.get(`/user/reviews/eligibility/${productId}`, { contextModule: "user" }),
  /** PUT /user/reviews/products/:productId { rating 1-5, title?, text?, images?[<=5 upload URLs], variantId? } - create or edit */
  saveProductReview: (productId, body) =>
    apiClient.put(`/user/reviews/products/${productId}`, body ?? {}, { contextModule: "user" }),
  deleteProductReview: (productId) =>
    apiClient.delete(`/user/reviews/products/${productId}`, { contextModule: "user" }),
  /** GET /user/reviews?productIds=a,b - the caller's own reviews */
  getMyProductReviews: (params = {}) =>
    apiClient.get("/user/reviews", { params, contextModule: "user" }),
  markReviewHelpful: (reviewId) =>
    apiClient.post(`/user/reviews/${reviewId}/helpful`, {}, { contextModule: "user" }),
  unmarkReviewHelpful: (reviewId) =>
    apiClient.delete(`/user/reviews/${reviewId}/helpful`, { contextModule: "user" }),
  reportProductReview: (reviewId, reason) =>
    apiClient.post(`/user/reviews/${reviewId}/report`, { reason }, { contextModule: "user" }),
  /**
   * Legacy UI compatibility: update "current user location".
   * We already persist the user's selected location in localStorage in the UI.
   * Keep this as a no-op success so existing flows don't break.
   */
  updateLocation: (_payload) =>
    Promise.resolve({
      data: { success: true, message: "Location saved (client)", data: null },
    }),
  saveFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "user" },
    );
  },
  removeFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "user",
      },
    );
  },
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.post("/fcm-tokens/test", { platform }, { contextModule: "user" });
  },
};
export const locationAPI = createStubAPI();
export const zoneAPI = {
  /** Public: detect active service zone for a lat/lng point. */
  detectZone: (lat, lng) =>
    apiClient.get("/content/zones/detect", {
      params: { lat, lng },
    }),
  /** Public: list active zones (for onboarding dropdowns). */
  getPublicZones: (params = {}, config = {}) =>
    apiClient.get("/content/zones/public", { params: params ?? {}, ...config }),
};
export const uploadAPI = {
  /**
   * Upload a single image file to the backend (VPS storage, nginx-served).
   * @param {File|Blob} file
   * @param {{ folder: string }} options - folder is required
   */
  uploadMedia: async (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }
    if (!options.folder || !String(options.folder).trim()) {
      return Promise.reject(new Error("Folder is required for upload"));
    }

    const uploadFile = await toUploadReadyImage(file);
    const folder = String(options.folder).trim();

    const formData = new FormData();
    formData.append("folder", folder);
    formData.append("file", uploadFile);

    const response = await apiClient.post("/uploads/image", formData, {
      params: { folder },
      headers: { "Content-Type": "multipart/form-data" },
    });

    const payload = response?.data?.data;
    if (payload?.url) {
      payload.url = resolveMediaUrl(payload.url);
    }

    return response;
  },
};
/** Order API (user app – Bearer USER token). Minimal calls: single create/verify, list/details cached by caller. */
export const orderAPI = {
  calculateCheckout: (payload) =>
    apiClient.post("/orders/checkout/calculate", payload ?? {}, {
      contextModule: "user",
    }),
  createCheckout: (payload) =>
    apiClient.post("/orders/checkout", payload ?? {}, { contextModule: "user" }),
  getCheckout: (checkoutId) =>
    apiClient.get(`/orders/checkout/${String(checkoutId)}`, {
      contextModule: "user",
    }),
  /** After the Razorpay sheet succeeds: `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }`. */
  verifyCheckoutPayment: (checkoutId, body) =>
    apiClient.post(`/orders/checkout/${String(checkoutId)}/verify-payment`, body ?? {}, {
      contextModule: "user",
    }),
  /** The customer closed the payment sheet: releases the held stock and coins. */
  abandonCheckout: (checkoutId) =>
    apiClient.post(`/orders/checkout/${String(checkoutId)}/abandon`, {}, {
      contextModule: "user",
    }),
  /** A fresh (or the still-open) Razorpay order for an unpaid online checkout; 409 once the hold has run out. */
  retryCheckoutPayment: (checkoutId) =>
    apiClient.post(`/orders/checkout/${String(checkoutId)}/retry-payment`, {}, {
      contextModule: "user",
    }),
  calculateOrder: (payload) =>
    apiClient.post("/orders/calculate", payload ?? {}, {
      contextModule: "user",
    }),
  createOrder: (payload) =>
    apiClient.post("/orders", payload ?? {}, { contextModule: "user" }),
  verifyPayment: (body) =>
    apiClient.post("/orders/verify-payment", body ?? {}, {
      contextModule: "user",
    }),
  abandonOnlinePayment: (orderId) =>
    apiClient.delete(`/orders/${String(orderId)}/pending-payment`, {
      contextModule: "user",
    }),
  getOrders: (() => {
    const inFlight = new Map();
    const cache = new Map();
    const CACHE_MS = 2000;

    const stableOrdersKey = (params = {}) => {
      const safe = params && typeof params === "object" ? { ...params } : {};
      const normalized = { limit: 20, page: 1, ...safe };
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, key) => {
            acc[key] = normalized[key];
            return acc;
          }, {}),
      );
    };

    return (params = {}) => {
      const key = stableOrdersKey(params);
      const now = Date.now();
      const cachedHit = cache.get(key);
      if (cachedHit && now - cachedHit.at < CACHE_MS) {
        return Promise.resolve(cachedHit.res);
      }

      const existing = inFlight.get(key);
      if (existing) return existing;

      const request = apiClient
        .get("/orders", {
          params: { limit: 20, page: 1, ...params },
          contextModule: "user",
        })
        .then((res) => {
          const payload = res?.data?.data;

          // Normalize backend paginated shape:
          // { data: { data: [...], meta: { total, page, limit, totalPages } } }
          // into UI-friendly:
          // { data: { orders: [...], pagination: { total, page, limit, pages } } }
          if (
            payload &&
            typeof payload === "object" &&
            Array.isArray(payload.data) &&
            payload.meta &&
            typeof payload.meta === "object"
          ) {
            const meta = payload.meta;
            const normalizedRes = {
              ...res,
              data: {
                ...res.data,
                data: {
                  ...payload,
                  orders: payload.data,
                  pagination: {
                    total: Number(meta.total || 0),
                    page: Number(meta.page || 1),
                    limit: Number(meta.limit || params.limit || 20),
                    pages: Number(meta.totalPages || 1),
                  },
                },
              },
            };
            cache.set(key, { at: Date.now(), res: normalizedRes });
            return normalizedRes;
          }

          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    };
  })(),
  getOrderDetails: (() => {
    const inFlight = new Map();
    const cache = new Map();
    /** Dedupes overlapping calls (StrictMode, poll + socket) without hiding fresh data for long. */
    const CACHE_MS = 800;

    return (orderId, options = {}) => {
      const key = String(orderId ?? "").trim();
      if (!key) {
        return Promise.reject(new Error("orderId required"));
      }

      const force = options.force === true;
      const now = Date.now();
      if (!force) {
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) {
          return Promise.resolve(hit.res);
        }
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const p = apiClient
        .get(`/orders/${key}`, { contextModule: "user" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  cancelOrder: (orderId, body = {}) =>
    apiClient.patch(`/orders/${String(orderId)}/cancel`, body ?? {}, {
      contextModule: "user",
    }),
  updateOrderInstructions: (orderId, instructions) =>
    apiClient.patch(`/orders/${String(orderId)}/instructions`, { instructions }, {
      contextModule: "user",
    }),
  submitOrderRatings: (orderId, body = {}) =>
    apiClient.patch(`/orders/${String(orderId)}/ratings`, body ?? {}, { contextModule: "user" }),
  /** Submit a complaint for an order (user). */
  submitComplaint: (payload) =>
    apiClient.post(
      "/user/support/ticket",
      {
        type: "order",
        orderId: payload.orderId,
        issueType: payload.complaintType,
        description: `${payload.subject}: ${payload.description}`,
      },
      { contextModule: "user" }
    ),
};

export const coinsAPI = {
  /** GET /user/coins/balance (Bearer USER) */
  getBalance: () => apiClient.get("/user/coins/balance", { contextModule: "user" }),
  /** GET /user/coins/ledger (Bearer USER) */
  getLedger: (params = {}) => apiClient.get("/user/coins/ledger", { params, contextModule: "user" }),
  /** GET /user/coins/expiring?days=30 (Bearer USER) */
  getExpiring: (days = 30) => apiClient.get("/user/coins/expiring", { params: { days }, contextModule: "user" }),
  /** GET /admin/coins/settings (Bearer ADMIN) */
  getSettings: () => apiClient.get("/admin/coins/settings", { contextModule: "admin" }),
  /** PATCH /admin/coins/settings (Bearer ADMIN) */
  updateSettings: (body) => apiClient.patch("/admin/coins/settings", body, { contextModule: "admin" }),
  /** POST /admin/coins/adjust (Bearer ADMIN) */
  adjustCoins: (body) => apiClient.post("/admin/coins/adjust", body, { contextModule: "admin" }),
  /** GET /admin/coins/report (Bearer ADMIN) */
  getReport: () => apiClient.get("/admin/coins/report", { contextModule: "admin" }),
  /** GET /admin/coins/users/:userId/ledger (Bearer ADMIN) */
  getUserLedger: (userId, params = {}) =>
    apiClient.get(`/admin/coins/users/${userId}/ledger`, { params, contextModule: "admin" }),
};

export const spinAPI = {
  /** GET /user/spin/status (Bearer USER) */
  getStatus: () => apiClient.get("/user/spin/status", { contextModule: "user" }),
  /** POST /user/spin/play (Bearer USER) */
  play: () => apiClient.post("/user/spin/play", {}, { contextModule: "user" }),
};

/** Admin: spin wheel campaigns (only one runs at a time) and the monthly report. */
export const spinAdminAPI = {
  listCampaigns: () => apiClient.get("/admin/spin/campaigns", { contextModule: "admin" }),
  /** body: { title, segments: [{ label, type: 'coins'|'none', value, weight, color }], dailyLimit, monthlyCoinBudget } */
  createCampaign: (body) => apiClient.post("/admin/spin/campaigns", body, { contextModule: "admin" }),
  updateCampaign: (id, body) => apiClient.patch(`/admin/spin/campaigns/${id}`, body, { contextModule: "admin" }),
  setCampaignActive: (id, isActive) =>
    apiClient.patch(`/admin/spin/campaigns/${id}/active`, { isActive }, { contextModule: "admin" }),
  /** params: { month: 'YYYY-MM' } */
  getReport: (params = {}) => apiClient.get("/admin/spin/report", { params, contextModule: "admin" }),
};

/** Admin: online payments checked against the gateway. params: { from, to } (ISO dates). */
export const paymentReconciliationAPI = {
  getReconciliation: (params = {}) =>
    apiClient.get("/admin/reports/payments/reconciliation", { params, contextModule: "admin" }),
};

export const aiAPI = {
  /** POST /ai/chat; pass back the conversationId it returns to keep one conversation. */
  chat: ({ message, history = [], conversationId = null }) =>
    apiClient.post("/ai/chat", { message, history, conversationId }, { contextModule: "user" }),
  /** POST /ai/handoff: link a conversation to the support ticket made from it. */
  linkHandoff: ({ conversationId, ticketId }) =>
    apiClient.post("/ai/handoff", { conversationId, ticketId }, { contextModule: "user" }),
};

/** Admin: assistant settings, stored conversations and token usage. */
export const adminAIAPI = {
  getSettings: () => apiClient.get("/admin/ai/settings", { contextModule: "admin" }),
  updateSettings: (body = {}) => apiClient.put("/admin/ai/settings", body, { contextModule: "admin" }),
  getConversations: (params = {}) =>
    apiClient.get("/admin/ai/conversations", { params, contextModule: "admin" }),
  getConversation: (id) =>
    apiClient.get(`/admin/ai/conversations/${id}`, { contextModule: "admin" }),
  getUsage: (params = {}) => apiClient.get("/admin/ai/usage", { params, contextModule: "admin" }),
};

export const heroBannerAPI = createStubAPI();
export const publicAPI = createStubAPI();
