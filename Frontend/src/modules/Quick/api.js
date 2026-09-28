/**
 * The quick-commerce customer API (/api/v1/qc), on the platform's API client.
 *
 * Quick commerce is store-first: a store ("restaurant" in the backend's words)
 * sells products ("foods"), and one order comes from one store. The customer
 * signs in once on the platform; /qc accepts that token and keeps its own
 * linked account (qc_users).
 *
 * Every call passes contextModule 'user' so the client attaches the customer's
 * token -- the URL alone would read /qc/restaurant/... as a store-owner call.
 */
import apiClient from "@food/api"

const USER = { contextModule: "user" }
const data = (res) => res?.data?.data ?? res?.data ?? {}

export const quickAPI = {
  // Where the customer is.
  detectZone: (lat, lng) => apiClient.get("/qc/zones/detect", { ...USER, params: { lat, lng } }).then(data),

  // Browsing (public).
  categories: (zoneId) =>
    apiClient.get("/qc/restaurant/categories/public", { ...USER, params: { zoneId, limit: 100 } }).then((r) => data(r).categories || []),
  products: ({ q, categoryId, zoneId, page = 1, limit = 30 } = {}) =>
    apiClient
      .get("/qc/search/products", { ...USER, params: { q: q || undefined, categoryId, zoneId, page, limit } })
      .then(data),
  stores: ({ zoneId, lat, lng, limit = 20 } = {}) =>
    apiClient
      .get("/qc/restaurant/restaurants", { ...USER, params: { zoneId, lat, lng, limit, sortBy: lat && lng ? "nearest" : undefined } })
      .then((r) => data(r).restaurants || []),
  /**
   * A page of stores with the listing's own sort: nearest (needs lat/lng),
   * rating or deliveryTime. Returns { restaurants, total, page }.
   */
  storesPage: ({ zoneId, lat, lng, sortBy, page = 1, limit = 24 } = {}) =>
    apiClient
      .get("/qc/restaurant/restaurants", { ...USER, params: { zoneId, lat, lng, sortBy, page, limit } })
      .then((r) => {
        const d = data(r)
        return { restaurants: d.restaurants || [], total: Number(d.total) || 0, page: Number(d.page) || page }
      }),
  store: (idOrSlug) => apiClient.get(`/qc/restaurant/restaurants/${idOrSlug}`, USER).then((r) => data(r).restaurant),
  menu: (id) => apiClient.get(`/qc/restaurant/restaurants/${id}/menu`, USER).then((r) => data(r).menu || { sections: [] }),
  heroBanners: () => apiClient.get("/qc/showcase-items/public", USER).then((r) => data(r).banners || []),

  // Signed-in customer.
  addresses: () => apiClient.get("/qc/user/addresses", USER).then((r) => data(r).addresses || []),
  addAddress: (body) => apiClient.post("/qc/user/addresses", body, USER).then((r) => data(r).address),
  // The platform's saved addresses (food / rides), offered to import.
  platformAddresses: () => apiClient.get("/food/user/addresses", USER).then((r) => data(r).addresses || []),

  calculate: (body) => apiClient.post("/qc/orders/calculate", body, USER).then(data),
  createOrder: (body, idempotencyKey) =>
    apiClient
      .post("/qc/orders", body, { ...USER, headers: { "Idempotency-Key": idempotencyKey } })
      .then(data),
  verifyPayment: (body) => apiClient.post("/qc/orders/verify-payment", body, USER).then(data),
  abandonPayment: (orderId) => apiClient.delete(`/qc/orders/${orderId}/pending-payment`, USER).then(data),
  orders: (page = 1) => apiClient.get("/qc/orders", { ...USER, params: { page, limit: 20 } }).then(data),
  order: (id) => apiClient.get(`/qc/orders/${id}`, USER).then((r) => data(r).order),
  cancelOrder: (id, reason) => apiClient.patch(`/qc/orders/${id}/cancel`, { reason }, USER).then((r) => data(r).order),
  // The rider's live route to their next stop (store before pickup, customer after).
  orderRoute: (id) => apiClient.get(`/qc/orders/${id}/route`, USER).then(data),
  // Once, after delivery. deliveryPartnerRating is required when a rider delivered it.
  rateOrder: (id, body) => apiClient.patch(`/qc/orders/${id}/ratings`, body, USER).then((r) => data(r).order),

  // Coupons the customer can use at this store (admin-wide and the store's own).
  // "/deals" is the server's ad-blocker-safe alias of /offers (routes/index.js).
  offers: (restaurantId) =>
    apiClient.get("/qc/restaurant/deals", { ...USER, params: { restaurantId } }).then((r) => data(r).allOffers || []),

  // Favourites: stores ("restaurants") and products ("foods").
  favorites: () => apiClient.get("/qc/user/favorites", USER).then(data),
  setFavorite: (kind, id, on) => {
    const path = `/qc/user/favorites/${kind === "store" ? "restaurants" : "foods"}/${id}`
    return (on ? apiClient.post(path, {}, USER) : apiClient.delete(path, USER)).then(data)
  },

  // Refer & earn.
  referrals: () => apiClient.get("/qc/user/referrals/details", USER).then(data),
}

export const errorMessage = (err, fallback = "Something went wrong. Please try again.") =>
  err?.response?.data?.message || err?.message || fallback
