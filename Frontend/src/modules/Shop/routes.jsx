import { Routes, Route, Navigate, useLocation } from "@shop/router"
import { useEffect, Suspense, lazy } from "react"
import ProtectedRoute from "@shop/components/ProtectedRoute"
import AuthRedirect from "@shop/components/AuthRedirect"
import Loader from "@shop/components/Loader"
import PushSoundEnableButton from "@shop/components/PushSoundEnableButton"
import { registerWebPushForCurrentModule } from "@shop/utils/firebaseMessaging"
import { isModuleAuthenticated } from "@shop/utils/auth"
import { useSellerNotifications } from "@shop/hooks/useSellerNotifications"
import { applyModulePowerScanning, getCachedSettings } from "@shop/utils/businessSettings"
import { PublicAppConfigProvider } from "@shop/context/PublicAppConfigContext"
import { shouldSkipScrollResetForHome } from "@shop/utils/homeScrollRestore"

// Lazy Loading Components
const UserRouter = lazy(() => import("@shop/components/user/UserRouter"))

// Seller Module
const SellerRouter = lazy(() => import("@shop/components/seller/SellerRouter"))

// The Shop admin is mounted by the platform at /admin/shop (see ShopAdminApp.jsx),
// and this vertical ships by courier, so there is no rider app here.

// Scroll to top on route change (skip when Home has a pending scroll restore)
function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    if (shouldSkipScrollResetForHome(location.pathname)) return;
    window.scrollTo(0, 0);
  }, [location.pathname, location.search, location.key]);
  return null;
}

function SellerGlobalNotificationListenerInner() {
  useSellerNotifications()
  return null
}

function SellerGlobalNotificationListener() {
  const location = useLocation()
  const isSellerRoute =
    location.pathname.startsWith("/seller") &&
    !location.pathname.startsWith("/sellers")
  const isSellerAuthRoute =
    location.pathname === "/seller/login" ||
    location.pathname === "/seller/auth/sign-in" ||
    location.pathname === "/seller/signup" ||
    location.pathname === "/seller/signup-email" ||
    location.pathname === "/seller/forgot-password" ||
    location.pathname === "/seller/otp" ||
    location.pathname === "/seller/welcome" ||
    location.pathname === "/seller/auth/google-callback"
  const isOrderManagedRoute =
    location.pathname === "/seller" ||
    location.pathname === "/seller/orders" ||
    location.pathname.startsWith("/seller/orders/")

  const shouldListen =
    isSellerRoute &&
    !isSellerAuthRoute &&
    !isOrderManagedRoute &&
    isModuleAuthenticated("seller")

  if (!shouldListen) {
    return null
  }

  return <SellerGlobalNotificationListenerInner />
}

export default function App() {
  const location = useLocation()

  useEffect(() => {
    registerWebPushForCurrentModule(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    const resolveModule = () => {
      if (location.pathname.startsWith("/seller")) return "seller"
      return "user"
    }

    const cached = getCachedSettings()
    if (cached) {
      applyModulePowerScanning(resolveModule(), cached)
    }
  }, [location.pathname])

  return (
    <PublicAppConfigProvider>
      <ScrollToTop />
      <SellerGlobalNotificationListener />
      <PushSoundEnableButton />
      <Suspense fallback={<Loader />}>
        <Routes>
          {/* Customer store -- /shop/* (paths here are relative to that mount) */}
          <Route
            path="/*"
            element={<UserRouter />}
          />

          {/* Seller panel -- /shop/seller/* */}
          <Route
            path="seller/*"
            element={
              <SellerRouter />
            }
          />

        </Routes>
      </Suspense>
    </PublicAppConfigProvider>
  )
}
