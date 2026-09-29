/**
 * The businesses a partner is signed into in this browser, and switching
 * between them.
 *
 * A restaurant and a Quick store (or medical store) share ONE session slot
 * (`restaurant_*` tokens plus the `restaurant_vertical` mark -- see
 * RESTAURANT_VERTICAL_KEY in services/api/axios.js), because the same
 * dashboard serves both. So an owner with both had to sign out of one to use
 * the other. This keeps each one's tokens aside under `partner_businesses` and
 * swaps them into the slot on demand. The Shop seller and Services vendor
 * panels already have slots of their own (`seller_*`, `vendor*`), so those are
 * only listed and opened, never copied.
 *
 * The slot stays the source of truth for whichever restaurant-side business is
 * active: its tokens refresh in place, so it is snapshotted back into the list
 * before anything replaces it.
 */
import { clearRestaurantSessionCache } from "@food/utils/auth"

const STORE_KEY = "partner_businesses"
const VERTICAL_KEY = "restaurant_vertical"
const SLOT = {
  access: "restaurant_accessToken",
  refresh: "restaurant_refreshToken",
  authenticated: "restaurant_authenticated",
  user: "restaurant_user",
}

// The two businesses that live in the restaurant slot.
const SLOT_BUSINESSES = {
  food: { label: "Restaurant", path: "/food/restaurant" },
  qc: { label: "Quick store", path: "/food/restaurant" },
}

const read = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const readJson = (key) => {
  try {
    return JSON.parse(read(key) || "null")
  } catch {
    return null
  }
}

const loadStore = () => {
  const store = readJson(STORE_KEY)
  return store && typeof store === "object" ? store : {}
}

const saveStore = (store) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // No storage: switching simply is not offered.
  }
}

/** Which restaurant-slot business is signed in right now, or null. */
export const activeSlotBusiness = () => {
  if (!read(SLOT.access)) return null
  return read(VERTICAL_KEY) === "qc" ? "qc" : "food"
}

const businessName = (user, fallback) =>
  String(user?.restaurantName || user?.storeName || user?.sellerName || user?.shopName || user?.businessName || user?.name || "").trim() || fallback

/**
 * Keep the business now in the restaurant slot, so a later sign-in or switch
 * does not lose it. Called before the slot is replaced, and whenever the
 * switcher shows, so refreshed tokens are the ones kept.
 */
export const rememberActiveSlotBusiness = () => {
  const key = activeSlotBusiness()
  if (!key) return
  const store = loadStore()
  store[key] = {
    accessToken: read(SLOT.access),
    refreshToken: read(SLOT.refresh),
    user: readJson(SLOT.user),
    savedAt: Date.now(),
  }
  saveStore(store)
}

/** Signing out of the restaurant slot forgets that business too. */
export const forgetActiveSlotBusiness = () => {
  const key = activeSlotBusiness()
  if (!key) return
  const store = loadStore()
  delete store[key]
  saveStore(store)
}

/**
 * Every business this browser holds a session for:
 * [{ key, label, name, path, active }]. `current` is the panel being viewed
 * ('food' | 'qc' | 'shop' | 'services').
 */
export const listBusinesses = (current) => {
  const store = loadStore()
  const activeSlot = activeSlotBusiness()
  const list = []

  for (const [key, meta] of Object.entries(SLOT_BUSINESSES)) {
    const saved = store[key]
    const isInSlot = activeSlot === key
    if (!saved?.accessToken && !isInSlot) continue
    const user = isInSlot ? readJson(SLOT.user) : saved?.user
    list.push({ key, label: meta.label, name: businessName(user, meta.label), path: meta.path, active: current === key })
  }

  if (read("seller_accessToken")) {
    list.push({ key: "shop", label: "Shop seller", name: businessName(readJson("seller_user"), "Shop store"), path: "/shop/seller", active: current === "shop" })
  }
  if (read("vendorAccessToken")) {
    list.push({ key: "services", label: "Services", name: businessName(readJson("vendorData"), "Services business"), path: "/services/vendor", active: current === "services" })
  }
  return list
}

/**
 * Open another business. A restaurant-slot business is swapped into the slot
 * (the current one kept first) and the dashboard reloaded, so no screen keeps
 * the previous business's data; the others are simply opened.
 */
export const switchToBusiness = (key) => {
  const target = SLOT_BUSINESSES[key]
  if (!target) {
    const other = listBusinesses().find((b) => b.key === key)
    if (other) window.location.assign(other.path)
    return
  }
  if (activeSlotBusiness() === key) {
    window.location.assign(target.path)
    return
  }

  rememberActiveSlotBusiness()
  const saved = loadStore()[key]
  if (!saved?.accessToken) return

  try {
    clearRestaurantSessionCache()
    localStorage.setItem(SLOT.access, saved.accessToken)
    if (saved.refreshToken) localStorage.setItem(SLOT.refresh, saved.refreshToken)
    else localStorage.removeItem(SLOT.refresh)
    localStorage.setItem(SLOT.authenticated, "true")
    if (saved.user) localStorage.setItem(SLOT.user, JSON.stringify(saved.user))
    else localStorage.removeItem(SLOT.user)
    if (key === "qc") localStorage.setItem(VERTICAL_KEY, "qc")
    else localStorage.removeItem(VERTICAL_KEY)
  } catch {
    return
  }
  window.location.assign(target.path)
}
