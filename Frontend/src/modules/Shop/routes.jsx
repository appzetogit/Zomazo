import { Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect, Suspense, lazy } from "react"
import ProtectedRoute from "@store/components/ProtectedRoute"
import AuthRedirect from "@store/components/AuthRedirect"
import Loader from "@store/components/Loader"
import PushSoundEnableButton from "@store/components/PushSoundEnableButton"
import { registerWebPushForCurrentModule } from "@store/utils/firebaseMessaging"
import { isModuleAuthenticated } from "@store/utils/auth"
import { useSellerNotifications } from "@store/hooks/useSellerNotifications"
import { applyModulePowerScanning, getCachedSettings } from "@store/utils/businessSettings"
import { PublicAppConfigProvider } from "@store/context/PublicAppConfigContext"
import { shouldSkipScrollResetForHome } from "@store/utils/homeScrollRestore"

// Lazy Loading Components
const UserRouter = lazy(() => import("@store/components/user/UserRouter"))

// Seller Module
const SellerRouter = lazy(() => import("@store/components/seller/SellerRouter"))

// Admin Module
const AdminRouter = lazy(() => import("@store/components/admin/AdminRouter"))
const AdminLogin = lazy(() => import("@store/pages/admin/auth/AdminLogin"))
const AdminForgotPassword = lazy(() => import("@store/pages/admin/auth/AdminForgotPassword"))

// Delivery Module
const DeliveryRouter = lazy(() => import("../DeliveryV2"))

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
      if (location.pathname.startsWith("/food/delivery") || location.pathname.startsWith("/delivery")) return "delivery"
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
          {/* User/Customer Module — mounted at root */}
          <Route
            path="/*"
            element={<UserRouter />}
          />

          {/* Seller Module */}
          <Route
            path="seller/*"
            element={
              <SellerRouter />
            }
          />

          {/* Delivery Module */}
          <Route
            path="delivery/*"
            element={<DeliveryRouter />}
          />
        </Routes>
      </Suspense>
    </PublicAppConfigProvider>
  )
}
