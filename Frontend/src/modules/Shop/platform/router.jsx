/**
 * react-router-dom, as the Shop sees it.
 *
 * The Shop was a standalone app that owned the site root: its links say
 * "/cart", "/seller/orders", "/admin/shop/orders", and its logic tests
 * `pathname.startsWith("/quick")` or `/^\/cart/`. Inside the platform it lives
 * at /shop (customer), /shop/seller (seller panel) and /admin/shop (admin).
 *
 * Rewriting several hundred paths by hand would be a large, error-prone diff
 * that drifts every time the upstream app changes. Instead every Shop file
 * imports the router from here (`@shop/router`), and this module translates at
 * the two boundaries:
 *
 *   outgoing  -- Link / NavLink / Navigate / useNavigate map an app path to its
 *                platform path ("/cart" -> "/shop/cart");
 *   incoming  -- useLocation hands back the app path ("/shop/cart" -> "/cart"),
 *                so the Shop's own path checks keep working untouched.
 *
 * Relative paths, numbers (navigate(-1)) and paths already in platform form
 * pass straight through.
 */
import { forwardRef, useCallback, useMemo } from "react";
import {
  Link as RRLink,
  NavLink as RRNavLink,
  Navigate as RRNavigate,
  useLocation as useRRLocation,
  useNavigate as useRRNavigate,
} from "react-router-dom";

export * from "react-router-dom";

export const SHOP_BASE = "/shop";
export const SHOP_SELLER_BASE = "/shop/seller";
export const SHOP_ADMIN_BASE = "/admin/shop";

const isPlatformPath = (p) =>
  p === SHOP_BASE || p.startsWith(`${SHOP_BASE}/`) ||
  p === SHOP_ADMIN_BASE || p.startsWith(`${SHOP_ADMIN_BASE}/`);

/** "/cart" -> "/shop/cart"; "/seller/x" -> "/shop/seller/x"; "/admin/..." -> "/admin/shop/...". */
export function toPlatformPath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return path;
  if (path.startsWith("//")) return path; // protocol-relative URL, not a route
  if (isPlatformPath(path)) return path;

  // The platform's own admin sign-in serves the Shop panel too.
  if (path === "/admin/login" || path.startsWith("/admin/login?")) return path;
  if (path === "/admin/forgot-password") return path;

  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?")) {
    // The standalone admin had two panels, /admin/quick/* and /admin/shop/*.
    // Here only Shop exists, so both land on it.
    const rest = path.replace(/^\/admin(\/(quick|shop))?/, "");
    return `${SHOP_ADMIN_BASE}${rest}`;
  }

  // Quick mode is not part of the Shop inside the platform (quick commerce is
  // its own vertical), so /quick/* is the Shop page of the same name.
  const withoutQuick = path.replace(/^\/quick(?=\/|$|\?)/, "") || "/";
  // Legacy aliases the standalone app still redirected.
  const withoutLegacy = withoutQuick.replace(/^\/(food\/user|food|user)(?=\/|$|\?)/, "") || "/";

  return withoutLegacy === "/" ? SHOP_BASE : `${SHOP_BASE}${withoutLegacy}`;
}

/** The inverse, for useLocation: "/shop/cart" -> "/cart", "/admin/shop/x" -> "/admin/shop/x". */
export function toAppPath(pathname) {
  if (typeof pathname !== "string") return pathname;
  if (pathname === SHOP_ADMIN_BASE || pathname.startsWith(`${SHOP_ADMIN_BASE}/`)) return pathname;
  if (pathname === SHOP_BASE) return "/";
  if (pathname.startsWith(`${SHOP_BASE}/`)) return pathname.slice(SHOP_BASE.length);
  return pathname;
}

const mapTo = (to) => {
  if (typeof to === "string") return toPlatformPath(to);
  if (to && typeof to === "object" && typeof to.pathname === "string") {
    return { ...to, pathname: toPlatformPath(to.pathname) };
  }
  return to;
};

export const Link = forwardRef(function ShopLink({ to, ...rest }, ref) {
  return <RRLink ref={ref} to={mapTo(to)} {...rest} />;
});

export const NavLink = forwardRef(function ShopNavLink({ to, ...rest }, ref) {
  return <RRNavLink ref={ref} to={mapTo(to)} {...rest} />;
});

export function Navigate({ to, ...rest }) {
  return <RRNavigate to={mapTo(to)} {...rest} />;
}

export function useNavigate() {
  const navigate = useRRNavigate();
  return useCallback(
    (to, options) => (typeof to === "number" ? navigate(to) : navigate(mapTo(to), options)),
    [navigate],
  );
}

export function useLocation() {
  const location = useRRLocation();
  return useMemo(
    () => ({ ...location, pathname: toAppPath(location.pathname) }),
    [location],
  );
}
