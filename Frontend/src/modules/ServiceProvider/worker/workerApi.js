import api from "../services/api"
import { workerAuthService } from "../services/authService"

/*
 * Every worker call the app makes. Paths are relative to the SP mount
 * (/api/v1/sp); services/api.js sends the worker token on /services/worker pages.
 * Sign-in goes through the shared workerAuthService so the tokens live in the
 * keys the refresh interceptor reads (workerAccessToken / workerRefreshToken).
 */

export const BASE = "/services/worker"

const data = (res) => res.data

export const workerApi = {
  // auth
  sendOtp: (phone) => workerAuthService.sendOTP(phone),
  verifyLogin: (phone, otp) => workerAuthService.verifyLogin({ phone, otp }),
  register: (payload) => workerAuthService.register(payload),
  logout: () => workerAuthService.logout(),

  // profile and duty
  profile: () => workerAuthService.getProfile(),
  updateProfile: (payload) => workerAuthService.updateProfile(payload),
  setOnline: (isOnline, coords) => api.post("/workers/toggle-online", { isOnline, ...(coords || {}) }).then(data),
  updateLocation: (lat, lng) => api.put("/workers/profile/location", { lat, lng }).then(data),
  stats: () => api.get("/workers/stats").then(data),

  // jobs
  requests: () => api.get("/workers/jobs/pending-requests").then(data),
  jobs: (params) => api.get("/workers/jobs", { params }).then(data),
  job: (id) => api.get(`/workers/jobs/${id}`).then(data),
  respond: (id, status) => api.put(`/workers/jobs/${id}/respond`, { status }).then(data),
  start: (id) => api.post(`/workers/jobs/${id}/start`).then(data),
  reached: (id) => api.post(`/workers/jobs/${id}/reached`).then(data),
  verifyVisit: (id, otp, location) => api.post(`/workers/jobs/${id}/visit/verify`, { otp, location }).then(data),
  setStatus: (id, status) => api.put(`/workers/jobs/${id}/status`, { status }).then(data),
  complete: (id, workDoneDetails) => api.post(`/workers/jobs/${id}/complete`, { workDoneDetails }).then(data),
  bill: (id) => api.get(`/workers/jobs/${id}/bill`).then(data),
  saveBill: (id, payload) => api.post(`/workers/jobs/${id}/bill`, payload).then(data),
  collect: (id, otp) => api.post(`/workers/jobs/${id}/payment/collect`, { otp }).then(data),
  addNotes: (id, notes) => api.post(`/workers/jobs/${id}/notes`, { notes }).then(data),
  catalogServices: () => api.get("/workers/catalog/services").then(data),
  catalogParts: () => api.get("/workers/catalog/parts").then(data),

  // earnings
  wallet: () => api.get("/workers/wallet").then(data),
  transactions: (params) => api.get("/workers/wallet/transactions", { params }).then(data),
  requestPayout: (bookingId) => api.post("/workers/wallet/request-payout", { bookingId }).then(data),
  withdraw: (payload) => api.post("/workers/wallet/withdraw", payload).then(data),
}

export const storedWorker = () => {
  try {
    return JSON.parse(localStorage.getItem("workerData") || "null")
  } catch {
    return null
  }
}

// The phone's position, if the worker allows it; never blocks a flow for long.
export const currentCoords = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  })
