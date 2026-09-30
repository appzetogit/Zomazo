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
 *
 * Businesses in other services this browser has no session for are found with
 * the partner pass (partnerPass.js; Backend core/partner/partnerHandoff.service.js)
 * and opened by a handoff: the server issues that service's own session, which
 * is stored exactly where that service's sign-in would store it.
 */
import axios from "axios"
import { clearRestaurantSessionCache } from "@food/utils/auth"
import { clearPartnerPass, getPartnerPass } from "./partnerPass"

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


// The server's kinds, and the keys this list uses for them.
const KIND_KEY = { food: "food", quick: "qc", shop: "shop", services: "services" }
const KEY_LABEL = { food: "Restaurant", qc: "Quick store", shop: "Shop seller", services: "Services" }

/** The id of the business this browser holds for each key, or "". */
const heldIds = () => {
  const store = loadStore()
  const active = activeSlotBusiness()
  const idOf = (user) => String(user?._id || user?.id || "")
  return {
    food: idOf(active === "food" ? readJson(SLOT.user) : store.food?.user),
    qc: idOf(active === "qc" ? readJson(SLOT.user) : store.qc?.user),
    shop: read("seller_accessToken") ? idOf(readJson("seller_user")) : "",
    services: read("vendorAccessToken") ? idOf(readJson("vendorData")) : "",
  }
}

/*
 * The pass endpoints, called with plain axios: the app's client treats a 401
 * as its own session ending and would sign the partner out of this panel.
 */
const partnerApi = async (method, path, body) => {
  const { default: apiClient } = await import("@/services/api/axios")
  return axios({
    method,
    url: `${apiClient.defaults.baseURL || "/api/v1"}/platform/partner${path}`,
    data: body,
    headers: { "X-Partner-Pass": getPartnerPass() },
  })
}

/**
 * This browser's businesses, then the partner's others found with the pass:
 * [{ key, label, name, path, active, remote?, state? }]. A business shown
 * with `remote` is opened by openRemoteBusiness; one whose `state` is not
 * 'approved' cannot be opened yet.
 */
export const discoverBusinesses = async (current) => {
  const local = listBusinesses(current)
  if (!getPartnerPass()) return local
  // Signed out of every business here: the pass goes too.
  if (!local.length) {
    clearPartnerPass()
    return local
  }
  let items = []
  try {
    items = (await partnerApi("get", "/businesses"))?.data?.data?.items || []
  } catch (err) {
    if (err?.response?.status === 401) clearPartnerPass()
    return local
  }
  const held = heldIds()
  const others = items
    .filter((b) => KIND_KEY[b.kind] && held[KIND_KEY[b.kind]] !== b.id)
    .map((b) => ({
      key: `${b.kind}:${b.id}`,
      label: KEY_LABEL[KIND_KEY[b.kind]],
      name: b.name,
      path: b.home,
      active: false,
      state: b.state,
      remote: { kind: b.kind, id: b.id },
    }))
  return [...local, ...others]
}

/**
 * Open a business this browser has no session for: the server signs it in by
 * its service's own rules, and its session is stored where that service's
 * sign-in keeps it. Throws with the server's message if it cannot be opened.
 */
export const openRemoteBusiness = async ({ kind, id }) => {
  let data
  try {
    data = (await partnerApi("post", "/handoff", { kind, id }))?.data?.data
  } catch (err) {
    throw new Error(err?.response?.data?.message || "This business could not be opened")
  }
  const session = data?.session
  if (!session?.accessToken) throw new Error("This business could not be opened")

  if (kind === "food" || kind === "quick") {
    // Into the restaurant slot, keeping whichever business was there.
    rememberActiveSlotBusiness()
    clearRestaurantSessionCache()
    localStorage.setItem(SLOT.access, session.accessToken)
    if (session.refreshToken) localStorage.setItem(SLOT.refresh, session.refreshToken)
    else localStorage.removeItem(SLOT.refresh)
    localStorage.setItem(SLOT.authenticated, "true")
    if (session.user) localStorage.setItem(SLOT.user, JSON.stringify(session.user))
    if (kind === "quick") localStorage.setItem(VERTICAL_KEY, "qc")
    else localStorage.removeItem(VERTICAL_KEY)
  } else if (kind === "shop") {
    const { setAuthData } = await import("@/modules/Shop/utils/auth")
    setAuthData("seller", session.accessToken, session.user, session.refreshToken)
  } else if (kind === "services") {
    localStorage.setItem("vendorAccessToken", session.accessToken)
    localStorage.setItem("vendorRefreshToken", session.refreshToken)
    localStorage.setItem("vendorData", JSON.stringify(session.vendor))
  }
  window.location.assign(data.home || "/")
}
