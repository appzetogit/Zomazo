/**
 * Which backend the restaurant panel is talking to.
 *
 * Stores and medical stores sign in through /partner and use this same panel,
 * with every /food/restaurant call rewritten to /qc/restaurant (see
 * RESTAURANT_VERTICAL_KEY in services/api/axios.js). The quick-commerce fork
 * does not have every food feature, so a few screens must not be offered to
 * those sellers at all -- they would load against a route that 404s, or save a
 * setting nothing on the quick-commerce side reads.
 */
import { RESTAURANT_VERTICAL_KEY } from "@food/api/axios"

export const isQcSeller = () => {
  try {
    return localStorage.getItem(RESTAURANT_VERTICAL_KEY) === "qc"
  } catch {
    return false
  }
}

/*
 * Panel pages that exist only for food restaurants, by their path under
 * /food/restaurant. Each is a food feature with no quick-commerce counterpart:
 *
 *  - combos: a combo is a special menu item food's pricing understands and
 *    quick-commerce pricing does not. (Free item and buy-one-get-one offers
 *    are shared: quick-commerce pricing applies them too, from the store's own
 *    offers -- Backend quickCommerce shared/offers.js.)
 *  - gst-settings: the "prices include GST" flag. Quick-commerce restaurants
 *    have no such field and its pricing always treats prices as net.
 *  - delivery-radius: food's per-outlet serviceRadiusKm. Quick-commerce
 *    serviceability is decided by zones, and nothing there reads a radius.
 */
export const FOOD_ONLY_SELLER_PAGES = Object.freeze([
  "combos",
  "gst-settings",
  "delivery-radius",
])

/** True when `route` (e.g. "/restaurant/combos") is a food-only page. */
export const isFoodOnlySellerRoute = (route) => {
  const last = String(route || "").split("?")[0].replace(/\/+$/, "").split("/").pop()
  return FOOD_ONLY_SELLER_PAGES.includes(last)
}
