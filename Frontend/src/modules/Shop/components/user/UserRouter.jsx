import { Routes, Route, Navigate, useParams } from "react-router-dom"
import UserLayout from "./UserLayout"
import { Suspense, lazy } from "react"
import Loader from "@store/components/Loader"
import ProtectedRoute from "@store/components/ProtectedRoute"
import useIsDesktop from "@store/components/user/desktop/useIsDesktop"

// Lazy Loading Pages

// Home & Discovery
const Home = lazy(() => import("@store/pages/user/Home"))
const Categories = lazy(() => import("@store/pages/user/Categories"))
const OrderAgain = lazy(() => import("@store/pages/user/OrderAgain"))
const MobileStoreView = lazy(() => import("@store/components/user/mobile/MobileStoreView"))
const MobileStoresList = lazy(() => import("@store/components/user/mobile/MobileStoresList"))
const MobileOrders = lazy(() => import("@store/components/user/mobile/MobileOrders"))
const MobileWishlist = lazy(() => import("@store/components/user/mobile/MobileWishlist"))
const CategoryPage = lazy(() => import("@store/pages/user/CategoryPage"))
const Sellers = lazy(() => import("@store/pages/user/sellers/Sellers"))
const SellerDetails = lazy(() => import("@store/pages/user/sellers/SellerDetails"))
const SearchResults = lazy(() => import("@store/pages/user/search/ProfessionalSearch"))
const ProductDetail = lazy(() => import("@store/pages/user/ProductDetail"))

// Cart
const Cart = lazy(() => import("@store/pages/user/cart/Cart"))
const SelectAddress = lazy(() => import("@store/pages/user/cart/SelectAddress"))
const AddressSelectorPage = lazy(() => import("@store/pages/user/cart/AddressSelectorPage"))

// Orders
const Orders = lazy(() => import("@store/pages/user/orders/Orders"))
const OrderTracking = lazy(() => import("@store/pages/user/orders/OrderTracking"))
const OrderInvoice = lazy(() => import("@store/pages/user/orders/OrderInvoice"))
const UserOrderDetails = lazy(() => import("@store/pages/user/orders/UserOrderDetails"))

// Offers
const Offers = lazy(() => import("@store/pages/user/Offers"))


// Collections
const Collections = lazy(() => import("@store/pages/user/Collections"))
const CollectionDetail = lazy(() => import("@store/pages/user/CollectionDetail"))



// Profile
const Profile = lazy(() => import("@store/pages/user/profile/Profile"))
const EditProfile = lazy(() => import("@store/pages/user/profile/EditProfile"))
const Payments = lazy(() => import("@store/pages/user/profile/Payments"))
const AddPayment = lazy(() => import("@store/pages/user/profile/AddPayment"))
const EditPayment = lazy(() => import("@store/pages/user/profile/EditPayment"))
const Favorites = lazy(() => import("@store/pages/user/profile/Favorites"))
const Support = lazy(() => import("@store/pages/user/profile/Support"))
const Coupons = lazy(() => import("@store/pages/user/profile/Coupons"))
const About = lazy(() => import("@store/pages/user/profile/About"))
const Terms = lazy(() => import("@store/pages/user/profile/Terms"))
const Privacy = lazy(() => import("@store/pages/user/profile/Privacy"))
const CMSHelpSupport = lazy(() => import("@store/pages/user/profile/CMSHelpSupport"))
const Refund = lazy(() => import("@store/pages/user/profile/Refund"))
const Shipping = lazy(() => import("@store/pages/user/profile/Shipping"))
const Cancellation = lazy(() => import("@store/pages/user/profile/Cancellation"))
const ReportSafetyEmergency = lazy(() => import("@store/pages/user/profile/ReportSafetyEmergency"))
const Accessibility = lazy(() => import("@store/pages/user/profile/Accessibility"))
const Logout = lazy(() => import("@store/pages/user/profile/Logout"))
const ReferEarn = lazy(() => import("@store/pages/user/profile/ReferEarn"))

// Auth
const SignIn = lazy(() => import("@store/pages/user/auth/SignIn"))
const OTP = lazy(() => import("@store/pages/user/auth/OTP"))
const AuthCallback = lazy(() => import("@store/pages/user/auth/AuthCallback"))

// Help
const Help = lazy(() => import("@store/pages/user/help/Help"))
const OrderHelp = lazy(() => import("@store/pages/user/help/OrderHelp"))

// Notifications
const Notifications = lazy(() => import("@store/pages/user/Notifications"))

// Wallet
const Wallet = lazy(() => import("@store/pages/user/Wallet"))
const Coins = lazy(() => import("@store/pages/user/Coins"))

// Complaints
const SubmitComplaint = lazy(() => import("@store/pages/user/complaints/SubmitComplaint"))

/**
 * Picks a route's layout by screen: the mobile-mockup view on phones, the
 * existing page from lg. Chosen here so neither one mounts (and fetches) on
 * the other's screens.
 */
function PhoneOr({ phone: Phone, wide: Wide }) {
  const onWideScreen = useIsDesktop()
  return onWideScreen ? <Wide /> : <Phone />
}

function StoreRoutePhone() {
  const { slug } = useParams()
  return <MobileStoreView slug={slug} />
}

export default function UserRouter() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route element={<UserLayout />}>
          {/* Storefronts: e-commerce shop at "/" and "/shop", and quick store at "/quick".
              Same page components; they read the mode from useStoreMode(). */}
          {["", "shop", "quick"].map((base) => (
            <Route key={base || "shop-root"} path={base || undefined}>
              <Route index element={<Home />} />
              <Route path="categories" element={<Categories />} />
              <Route path="order-again" element={<OrderAgain />} />
              <Route path="category/:category" element={<CategoryPage />} />
              <Route path="sellers" element={<PhoneOr phone={MobileStoresList} wide={Sellers} />} />
              <Route path="sellers/:slug" element={<PhoneOr phone={StoreRoutePhone} wide={SellerDetails} />} />
              <Route path="stores" element={<Sellers />} />
              <Route path="stores/:slug" element={<SellerDetails />} />
              <Route path="wishlist" element={<PhoneOr phone={MobileWishlist} wide={Favorites} />} />
              <Route path="search" element={<SearchResults />} />
              <Route path="product/:id" element={<ProductDetail />} />
              <Route path="cart" element={<Cart />} />
              <Route path="cart/select-address" element={<SelectAddress />} />
              <Route path="cart/address-selector" element={<AddressSelectorPage />} />
            </Route>
          ))}

          {/* Orders - Protected (require user auth) */}
          <Route
            path="orders"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <PhoneOr phone={MobileOrders} wide={Orders} />
              </ProtectedRoute>
            }
          />
          <Route
            path="orders/:orderId"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <OrderTracking />
              </ProtectedRoute>
            }
          />
          <Route
            path="orders/:orderId/invoice"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <OrderInvoice />
              </ProtectedRoute>
            }
          />
          <Route
            path="orders/:orderId/details"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <UserOrderDetails />
              </ProtectedRoute>
            }
          />

          {/* Offers */}
          <Route path="offers" element={<Offers />} />


          {/* Collections */}
          <Route path="collections" element={<Collections />} />
          <Route path="collections/:id" element={<CollectionDetail />} />



          {/* Profile - Protected (require user auth) */}
          <Route
            path="profile"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/edit"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <EditProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/payments"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Payments />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/payments/new"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <AddPayment />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/payments/:id/edit"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <EditPayment />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/favorites"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <PhoneOr phone={MobileWishlist} wide={Favorites} />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/support"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Support />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/coupons"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Coupons />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/about"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <About />
              </ProtectedRoute>
            }
          />

          <Route
            path="profile/report-safety-emergency"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <ReportSafetyEmergency />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/accessibility"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Accessibility />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/logout"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Logout />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/refer-earn"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <ReferEarn />
              </ProtectedRoute>
            }
          />

          {/* Public Legal Policies (stay public) */}
          <Route path="profile/terms" element={<Terms />} />
          <Route path="profile/privacy" element={<Privacy />} />
<Route path="profile/help-content" element={<CMSHelpSupport />} />
          <Route path="profile/refund" element={<Refund />} />
          <Route path="profile/shipping" element={<Shipping />} />
          <Route path="profile/cancellation" element={<Cancellation />} />

          {/* Auth - User login is centralized at /user/auth/login */}
          <Route path="auth/login" element={<SignIn />} />
          <Route path="auth/sign-in" element={<SignIn />} />
          <Route path="auth/otp" element={<OTP />} />
          <Route path="auth/callback" element={<AuthCallback />} />

          {/* Help */}
          <Route path="help" element={<Help />} />
          <Route path="help/orders/:orderId" element={<OrderHelp />} />

          {/* Notifications - Protected (user auth) */}
          <Route
            path="notifications"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Notifications />
              </ProtectedRoute>
            }
          />

          {/* Wallet - Protected (user auth) */}
          <Route
            path="wallet"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Wallet />
              </ProtectedRoute>
            }
          />

          {/* Coins - balance, expiring lots and history (user auth) */}
          <Route
            path="coins"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <Coins />
              </ProtectedRoute>
            }
          />

          {/* Complaints - Protected (user auth) */}
          <Route
            path="complaints/submit/:orderId"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/auth/login">
                <SubmitComplaint />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  )
}
