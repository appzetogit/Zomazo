/**
 * The service-booking customer API (/api/v1/sp), on the platform's API client.
 *
 * The catalogue is category -> brand -> service. A booking is for one service
 * (plus any others from the same category as extra lines) at an address and a
 * time slot; the backend then dispatches it to the nearest free professional,
 * so the customer never picks one.
 *
 * The customer signs in once on the platform. /sp accepts that token and keeps
 * a linked account of its own (sp_users) -- see the SP auth middleware's
 * identity bridge. Every call passes contextModule 'user' so the client
 * attaches the customer's token and refreshes it the same way food does:
 * without it, paths like /sp/admin/... would be read by URL alone.
 */
import apiClient from "@food/api"

const USER = { contextModule: "user" }
const body = (res) => res?.data ?? {}

export const servicesAPI = {
  // Browsing (public).
  homeData: () => apiClient.get("/sp/public/home-data", USER).then(body),
  categories: () => apiClient.get("/sp/public/categories", USER).then((r) => body(r).categories || []),
  brands: (categoryId) =>
    apiClient.get("/sp/public/brands", { ...USER, params: { categoryId } }).then((r) => body(r).brands || []),
  services: (params = {}) =>
    apiClient.get("/sp/public/services", { ...USER, params }).then((r) => body(r).services || []),
  service: (id) => apiClient.get(`/sp/public/services/${id}`, USER).then(body),
  providers: (categoryId) =>
    apiClient.get("/sp/public/providers", { ...USER, params: { categoryId, limit: 30 } }).then(body),
  provider: (id) => apiClient.get(`/sp/public/providers/${id}`, USER).then(body),
  config: () => apiClient.get("/sp/public/config", USER).then((r) => body(r).settings || {}),

  // Signed-in customer.
  profile: () => apiClient.get("/sp/users/profile", USER).then((r) => body(r).user || {}),
  // The platform's saved addresses (food / rides), which carry coordinates.
  platformAddresses: () =>
    apiClient.get("/food/user/addresses", USER).then((r) => {
      const d = body(r)
      return d?.data?.addresses || d?.addresses || (Array.isArray(d?.data) ? d.data : [])
    }),
  savePlatformAddress: (address) => apiClient.post("/food/user/addresses", address, USER).then(body),

  // Coupons: the list offered at checkout, and a check of one code against the
  // amount. The booking itself is priced on the server from the code alone.
  coupons: () => apiClient.get("/sp/users/coupons", USER).then((r) => body(r).data || []),
  validateCoupon: (code, amount) =>
    apiClient.post("/sp/users/coupons/validate", { code, amount }, USER).then((r) => body(r).data),

  // Refer and earn.
  referral: () => apiClient.get("/sp/users/referral", USER).then((r) => body(r).data || {}),
  applyReferral: (code) => apiClient.post("/sp/users/referral/apply", { code }, USER).then(body),

  // Saved services.
  favourites: () => apiClient.get("/sp/users/favourites", USER).then(body),
  saveFavourite: (serviceId) => apiClient.put(`/sp/users/favourites/${serviceId}`, null, USER).then((r) => body(r).ids || []),
  removeFavourite: (serviceId) => apiClient.delete(`/sp/users/favourites/${serviceId}`, USER).then((r) => body(r).ids || []),

  createBooking: (payload) => apiClient.post("/sp/users/bookings", payload, USER).then((r) => body(r).data),
  bookings: (params = {}) => apiClient.get("/sp/users/bookings", { ...USER, params }).then(body),
  booking: (id) => apiClient.get(`/sp/users/bookings/${id}`, USER).then((r) => body(r).data),
  cancel: (id, cancellationReason) =>
    apiClient.post(`/sp/users/bookings/${id}/cancel`, { cancellationReason }, USER).then(body),
  reschedule: (id, slot) => apiClient.put(`/sp/users/bookings/${id}/reschedule`, slot, USER).then(body),
  review: (id, rating, review) =>
    apiClient.post(`/sp/users/bookings/${id}/review`, { rating, review }, USER).then(body),

  // Online payment: a Razorpay order for the booking's current total, then the
  // signed result back for the server to verify against the gateway.
  createPaymentOrder: (bookingId) =>
    apiClient.post("/sp/payments/create-order", { bookingId }, USER).then((r) => body(r).data),
  verifyPayment: (payload) => apiClient.post("/sp/payments/verify", payload, USER).then(body),
}

export const errorMessage = (err, fallback = "Something went wrong. Please try again.") =>
  err?.response?.data?.errors?.[0]?.msg || err?.response?.data?.message || err?.message || fallback
