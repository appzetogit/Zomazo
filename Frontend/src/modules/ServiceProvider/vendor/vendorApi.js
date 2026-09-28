import api from "../services/api"
import { vendorAuthService } from "../services/authService"

/*
 * Every vendor call the app makes, in one place. Paths are relative to the SP
 * mount (/api/v1/sp); services/api.js attaches the vendor token because every
 * vendor page lives under /services/vendor.
 *
 * Sign-in and profile go through the shared vendorAuthService so the tokens land
 * in the same keys (vendorAccessToken / vendorRefreshToken / vendorData) that the
 * refresh interceptor and the rest of the SP code already read.
 */

export const BASE = "/services/vendor"

const data = (res) => res.data

export const vendorApi = {
  // auth
  sendOtp: (phone) => vendorAuthService.sendOTP(phone),
  verifyLogin: (phone, otp) => vendorAuthService.verifyLogin({ phone, otp }),
  register: (payload) => vendorAuthService.register(payload),
  logout: () => vendorAuthService.logout(),

  // profile and settings
  profile: () => vendorAuthService.getProfile(),
  updateProfile: (payload) => vendorAuthService.updateProfile(payload),
  updateAddress: (payload) => api.put("/vendors/address", payload).then(data),
  settings: () => api.get("/vendors/settings").then(data),
  updateSettings: (payload) => api.put("/vendors/settings", payload).then(data),

  // dashboard
  stats: () => api.get("/vendors/dashboard/stats").then(data),
  revenue: (period = "monthly") => api.get("/vendors/dashboard/revenue", { params: { period } }).then(data),
  workerPerformance: () => api.get("/vendors/dashboard/workers").then(data),

  // bookings
  pending: () => api.get("/vendors/bookings/pending").then(data),
  bookings: (params) => api.get("/vendors/bookings", { params }).then(data),
  booking: (id) => api.get(`/vendors/bookings/${id}`).then(data),
  accept: (id) => api.post(`/vendors/bookings/${id}/accept`).then(data),
  reject: (id, reason) => api.post(`/vendors/bookings/${id}/reject`, { reason }).then(data),
  assignWorker: (id, workerId) => api.post(`/vendors/bookings/${id}/assign-worker`, { workerId }).then(data),
  addNotes: (id, notes) => api.post(`/vendors/bookings/${id}/notes`, { notes }).then(data),
  ratings: () => api.get("/vendors/bookings/ratings").then(data),

  // doing the job yourself
  selfStart: (id) => api.post(`/vendors/bookings/${id}/self/start`).then(data),
  selfReached: (id) => api.post(`/vendors/bookings/${id}/self/reached`).then(data),
  selfVerifyVisit: (id, otp) => api.post(`/vendors/bookings/${id}/self/visit/verify`, { otp }).then(data),
  selfComplete: (id, billDetails) => api.post(`/vendors/bookings/${id}/self/complete`, { billDetails }).then(data),
  selfCollect: (id, otp) => api.post(`/vendors/bookings/${id}/self/payment/collect`, { otp }).then(data),

  // bill for a job a worker did, and paying that worker
  bill: (id) => api.get(`/vendors/bookings/${id}/bill`).then(data),
  saveBill: (id, payload) => api.post(`/vendors/bookings/${id}/bill`, payload).then(data),
  payWorker: (id) => api.post(`/vendors/bookings/${id}/pay-worker`).then(data),

  // workers
  workers: (params) => api.get("/vendors/workers", { params }).then(data),
  addWorker: (payload) => api.post("/vendors/workers", payload).then(data),
  linkWorker: (phone) => api.post("/vendors/workers/link", { phone }).then(data),
  updateWorker: (id, payload) => api.put(`/vendors/workers/${id}`, payload).then(data),
  removeWorker: (id) => api.delete(`/vendors/workers/${id}`).then(data),

  // services and catalogue
  categories: () => api.get("/public/categories").then(data),
  services: (params) => api.get("/vendors/services", { params }).then(data),
  setAvailability: (serviceId, isAvailable) =>
    api.put(`/vendors/services/${serviceId}/availability`, { isAvailable }).then(data),
  // No price clears the override (the route's validator rejects an explicit null).
  setPrice: (serviceId, price) =>
    api.put(`/vendors/services/${serviceId}/pricing`, price == null ? {} : { basePrice: price }).then(data),
  catalogServices: () => api.get("/vendors/catalog/services").then(data),
  catalogParts: () => api.get("/vendors/catalog/parts").then(data),

  // wallet
  wallet: () => api.get("/vendors/wallet").then(data),
  walletSummary: () => api.get("/vendors/wallet/summary").then(data),
  transactions: (params) => api.get("/vendors/wallet/transactions", { params }).then(data),
  settlements: () => api.get("/vendors/wallet/settlements").then(data),
  requestSettlement: (payload) => api.post("/vendors/wallet/settlement", payload).then(data),
  withdrawals: () => api.get("/vendors/wallet/withdrawals").then(data),
  withdraw: (payload) => api.post("/vendors/withdraw", payload).then(data),

  // notifications
  notifications: () => api.get("/notifications/vendor").then(data),
  markAllRead: () => api.put("/notifications/read-all").then(data),
}

export const storedVendor = () => {
  try {
    return JSON.parse(localStorage.getItem("vendorData") || "null")
  } catch {
    return null
  }
}
