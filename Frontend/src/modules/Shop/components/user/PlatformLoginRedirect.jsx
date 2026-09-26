// Imported from react-router-dom directly, not @shop/router: this component's
// whole job is to leave the Shop's /shop space for the platform's /login.
import { Navigate, useLocation } from "react-router-dom";
import { toAppPath, toPlatformPath } from "@shop/router";

/**
 * The Shop's /auth/login, /auth/sign-in and /auth/otp, inside the platform.
 *
 * A customer has ONE login across food, rides and the Shop -- the platform's
 * /login, which writes the same user_accessToken the Shop reads. The standalone
 * sign-in pages called the module's own customer OTP endpoints, which the
 * backend no longer mounts (they minted accounts unlinked from the platform
 * identity), so these routes send the customer to the platform login instead,
 * carrying where they were going so they come back to it.
 */
export default function PlatformLoginRedirect() {
  const location = useLocation();
  const raw = location.state?.from;
  const fromApp = typeof raw === "string" ? raw : raw?.pathname || "/";
  const returnTo = toPlatformPath(toAppPath(fromApp) || "/");
  return <Navigate to="/login" replace state={{ from: { pathname: returnTo } }} />;
}
