import { useCallback, useMemo } from "react"
import { useLocation } from "@shop/router"

// The customer site has two storefronts with separate carts:
//   /        -> "shop"  (e-commerce, courier-shipped, fulfilmentMode "standard")
//   /quick   -> "quick" (rider delivery in minutes, fulfilmentMode "quick")
// A checkout is always all-quick or all-standard, never mixed.
export const QUICK_BASE = "/quick"

// Quick (rider, minutes) is not part of the Shop inside the platform: quick
// delivery is the quick-commerce vertical's. The /quick pages are unreachable
// (the router maps /quick to the Shop page of the same name), and every
// Shop | Quick switch is hidden behind this flag rather than deleted, so the
// code stays close to the upstream app.
export const QUICK_MODE_ENABLED = false

export function getStoreModeFromPath(pathname = "") {
  return pathname === QUICK_BASE || pathname.startsWith(`${QUICK_BASE}/`) ? "quick" : "shop"
}

export function fulfilmentModeFor(mode) {
  return mode === "quick" ? "quick" : "standard"
}

export function cartStorageKeyFor(mode) {
  return mode === "quick" ? "cart_quick" : "cart"
}

export const CART_STORAGE_KEYS = ["cart", "cart_quick"]

// Prefix a storefront path ("/cart", "/product/1") with the current store base.
export function storePathFor(mode, path = "/") {
  const clean = path.startsWith("/") ? path : `/${path}`
  if (mode !== "quick") return clean
  if (clean.startsWith(`${QUICK_BASE}/`) || clean === QUICK_BASE) return clean
  return clean === "/" ? QUICK_BASE : `${QUICK_BASE}${clean}`
}

export function useStoreMode() {
  const { pathname } = useLocation()
  const mode = getStoreModeFromPath(pathname)
  const storePath = useCallback((path) => storePathFor(mode, path), [mode])
  return useMemo(
    () => ({
      mode,
      isQuick: mode === "quick",
      fulfilmentMode: fulfilmentModeFor(mode),
      basePath: mode === "quick" ? QUICK_BASE : "",
      storePath,
    }),
    [mode, storePath],
  )
}
