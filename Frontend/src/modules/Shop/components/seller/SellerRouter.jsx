import { Suspense, lazy, useEffect } from "react"
import { Routes, Route, Outlet } from "@shop/router"
import ProtectedRoute from "@shop/components/ProtectedRoute"
import AuthRedirect from "@shop/components/AuthRedirect"
import Loader from "@shop/components/Loader"
import SellerLayout from "@shop/components/seller/SellerLayout"
import { applyModuleBranding, getCachedSettings, loadBusinessSettings } from "@shop/utils/businessSettings"

const LayoutWrapper = () => (
  <SellerLayout>
    <Outlet />
  </SellerLayout>
)

// Lazy Loading Components
const AllOrdersPage = lazy(() => import("@shop/pages/seller/AllOrdersPage"))
const OrdersMain = lazy(() => import("@shop/pages/seller/OrdersMain"))
const SellerNotifications = lazy(() => import("@shop/pages/seller/Notifications"))
const SellerOnboarding = lazy(() => import("@shop/pages/seller/Onboarding"))
const CouponListPage = lazy(() => import("@shop/pages/seller/CouponListPage"))
const Advertise = lazy(() => import("@shop/pages/seller/Advertise"))
const AddCouponPage = lazy(() => import("@shop/pages/seller/AddCouponPage"))
const EditCouponPage = lazy(() => import("@shop/pages/seller/EditCouponPage"))
const MenuCategoriesPage = lazy(() => import("@shop/pages/seller/MenuCategoriesPage"))
const DeliverySettings = lazy(() => import("@shop/pages/seller/DeliverySettings"))
const RushHour = lazy(() => import("@shop/pages/seller/RushHour"))
const OutletTimings = lazy(() => import("@shop/pages/seller/OutletTimings"))
const DaySlots = lazy(() => import("@shop/pages/seller/DaySlots"))
const OutletInfo = lazy(() => import("@shop/pages/seller/OutletInfo"))
const RatingsReviews = lazy(() => import("@shop/pages/seller/RatingsReviews"))
const EditOwner = lazy(() => import("@shop/pages/seller/EditOwner"))
const EditSellerAddress = lazy(() => import("@shop/pages/seller/EditSellerAddress"))
const Inventory = lazy(() => import("@shop/pages/seller/Inventory"))
const Feedback = lazy(() => import("@shop/pages/seller/Feedback"))
const ShareFeedback = lazy(() => import("@shop/pages/seller/ShareFeedback"))
const DishRatings = lazy(() => import("@shop/pages/seller/DishRatings"))
const SellerSupport = lazy(() => import("@shop/pages/seller/SellerSupport"))
const FssaiDetails = lazy(() => import("@shop/pages/seller/FssaiDetails"))
const FssaiUpdate = lazy(() => import("@shop/pages/seller/FssaiUpdate"))
const ItemDetailsPage = lazy(() => import("@shop/pages/seller/ItemDetailsPage"))
const HubFinance = lazy(() => import("@shop/pages/seller/HubFinance"))
const FinanceDetailsPage = lazy(() => import("@shop/pages/seller/FinanceDetailsPage"))
const WithdrawalHistoryPage = lazy(() => import("@shop/pages/seller/WithdrawalHistoryPage"))
const PhoneNumbersPage = lazy(() => import("@shop/pages/seller/PhoneNumbersPage"))
const DownloadReport = lazy(() => import("@shop/pages/seller/DownloadReport"))
const ManageOutlets = lazy(() => import("@shop/pages/seller/ManageOutlets"))
const UpdateBankDetails = lazy(() => import("@shop/pages/seller/UpdateBankDetails"))
const ZoneSetup = lazy(() => import("@shop/pages/seller/ZoneSetup"))
const SellerStatus = lazy(() => import("@shop/pages/seller/SellerStatus"))
const ExploreMore = lazy(() => import("@shop/pages/seller/ExploreMore"))
const SellerPrivacy = lazy(() => import("@shop/pages/seller/Privacy"))
const SellerTerms = lazy(() => import("@shop/pages/seller/Terms"))
const SellerCMSHelpSupport = lazy(() => import("@shop/pages/seller/CMSHelpSupport"))
const OrderDetailPage = lazy(() => import("@shop/pages/seller/OrderDetailPage"))

const Welcome = lazy(() => import("@shop/pages/seller/auth/Welcome"))
const Login = lazy(() => import("@shop/pages/seller/auth/Login"))
const OTP = lazy(() => import("@shop/pages/seller/auth/OTP"))
const Signup = lazy(() => import("@shop/pages/seller/auth/Signup"))
const VerificationPending = lazy(() => import("@shop/pages/seller/auth/VerificationPending"))
const Subscription = lazy(() => import("@shop/pages/seller/Subscription"))

export default function SellerRouter() {
  // Safely enforce light mode for the Seller app to prevent User dark mode bleeding
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    return () => {
      const savedTheme = localStorage.getItem('appTheme') || 'light';
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      }
    };
  }, []);

  useEffect(() => {
    const applyBranding = async () => {
      const cached = getCachedSettings()
      if (cached) {
        applyModuleBranding("seller", cached)
      } else {
        const settings = await loadBusinessSettings()
        applyModuleBranding("seller", settings)
      }
    }

    applyBranding()
    const handleSettingsUpdate = () => applyBranding()
    window.addEventListener("businessSettingsUpdated", handleSettingsUpdate)
    return () => window.removeEventListener("businessSettingsUpdated", handleSettingsUpdate)
  }, [])

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Auth Routes */}
        <Route path="welcome" element={<AuthRedirect module="seller"><Welcome /></AuthRedirect>} />
        <Route path="login" element={<AuthRedirect module="seller"><Login /></AuthRedirect>} />
        <Route path="otp" element={<AuthRedirect module="seller"><OTP /></AuthRedirect>} />
        <Route path="signup" element={<AuthRedirect module="seller"><Signup /></AuthRedirect>} />
        <Route path="pending-verification" element={<AuthRedirect module="seller"><VerificationPending /></AuthRedirect>} />

        <Route path="onboarding" element={<AuthRedirect module="seller"><SellerOnboarding /></AuthRedirect>} />

        {/* Protected app shell (desktop sidebar + mobile chrome) */}
        <Route element={<LayoutWrapper />}>
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><OrdersMain /></ProtectedRoute>} path="" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><SellerNotifications /></ProtectedRoute>} path="notifications" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><AllOrdersPage /></ProtectedRoute>} path="orders/all" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><OrderDetailPage /></ProtectedRoute>} path="orders/:id" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><CouponListPage /></ProtectedRoute>} path="coupon" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><Advertise /></ProtectedRoute>} path="advertise" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><AddCouponPage /></ProtectedRoute>} path="coupon/new" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><EditCouponPage /></ProtectedRoute>} path="coupon/:id/edit" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><DeliverySettings /></ProtectedRoute>} path="delivery-settings" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><RushHour /></ProtectedRoute>} path="rush-hour" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><MenuCategoriesPage /></ProtectedRoute>} path="menu-categories" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><SellerStatus /></ProtectedRoute>} path="status" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><ExploreMore /></ProtectedRoute>} path="explore" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><OutletTimings /></ProtectedRoute>} path="outlet-timings" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><DaySlots /></ProtectedRoute>} path="outlet-timings/:day" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><OutletInfo /></ProtectedRoute>} path="outlet-info" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><RatingsReviews /></ProtectedRoute>} path="ratings-reviews" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><EditOwner /></ProtectedRoute>} path="edit-owner" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><EditSellerAddress /></ProtectedRoute>} path="edit-address" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><Inventory /></ProtectedRoute>} path="inventory" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><Feedback /></ProtectedRoute>} path="feedback" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><ShareFeedback /></ProtectedRoute>} path="share-feedback" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><DishRatings /></ProtectedRoute>} path="dish-ratings" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><SellerSupport /></ProtectedRoute>} path="help-centre/support" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><FssaiDetails /></ProtectedRoute>} path="fssai" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><FssaiUpdate /></ProtectedRoute>} path="fssai/update" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><ItemDetailsPage /></ProtectedRoute>} path="hub-menu/item/:id" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><HubFinance /></ProtectedRoute>} path="hub-finance" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><Subscription /></ProtectedRoute>} path="subscription" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><WithdrawalHistoryPage /></ProtectedRoute>} path="withdrawal-history" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><FinanceDetailsPage /></ProtectedRoute>} path="finance-details" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><PhoneNumbersPage /></ProtectedRoute>} path="phone" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><DownloadReport /></ProtectedRoute>} path="download-report" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><ManageOutlets /></ProtectedRoute>} path="manage-outlets" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><UpdateBankDetails /></ProtectedRoute>} path="update-bank-details" />
          <Route element={<ProtectedRoute requiredRole="seller" loginPath="/seller/login"><ZoneSetup /></ProtectedRoute>} path="zone-setup" />
        </Route>

        {/* CMS Content Routes (Stay public-accessible but inside router) */}
        <Route path="privacy" element={<SellerPrivacy />} />
        <Route path="terms" element={<SellerTerms />} />
        <Route path="help-content" element={<SellerCMSHelpSupport />} />
      </Routes>
    </Suspense>
  )
}
