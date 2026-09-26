import { useLocation } from "react-router-dom"

/**
 * The admin is two panels over one set of pages:
 *   /admin/quick -> quick commerce (rider delivery), orders with fulfilmentMode "quick"
 *   /admin/shop  -> e-commerce (courier shipping), orders with fulfilmentMode "standard"
 * The panel is read from the URL so any component under /admin can use it
 * without a provider.
 */
export const ADMIN_PANELS = {
  quick: { key: "quick", label: "Quick", fulfilmentMode: "quick" },
  shop: { key: "shop", label: "Shop", fulfilmentMode: "standard" },
}

export const DEFAULT_ADMIN_PANEL = "quick"

const PANEL_PATH = /^\/admin\/(quick|shop)(?=\/|$)/

export function getAdminPanelFromPath(pathname = "") {
  const match = String(pathname).match(PANEL_PATH)
  return match ? match[1] : DEFAULT_ADMIN_PANEL
}

/** Path inside the panel, e.g. "/admin/shop/orders/all" -> "/orders/all" ("" for the dashboard). */
export function getAdminSubPath(pathname = "") {
  return String(pathname).replace(PANEL_PATH, "").replace(/\/+$/, "")
}

export function useAdminPanel() {
  const { pathname } = useLocation()
  const panel = getAdminPanelFromPath(pathname)
  // channel: the seller/product sales channel this panel shows (quick|shop), see CHANNELS_CONTRACT.md
  return { panel, channel: panel, fulfilmentMode: ADMIN_PANELS[panel].fulfilmentMode, label: ADMIN_PANELS[panel].label }
}

/** "/admin/quick" or "/admin/shop"; append sub-paths to it. */
export function useAdminBase() {
  return `/admin/${useAdminPanel().panel}`
}

/**
 * Re-roots an admin path onto a panel. Paths built elsewhere (the backend's
 * global search, older notifications) still say /admin/store/...
 */
export function toPanelPath(path, panel = DEFAULT_ADMIN_PANEL) {
  const value = String(path || "")
  if (!value.startsWith("/admin")) return value
  return value.replace(/^\/admin\/(store|food|quick|shop)(?=\/|\?|#|$)/, `/admin/${panel}`)
}
