import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { PartnerGuard } from "../components/partner/PartnerAuth"
import { Spinner } from "../components/partner/ui"
import { BASE } from "./vendorApi"

const Login = lazy(() => import("./pages/Login"))
const Register = lazy(() => import("./pages/Register"))
const UnderReview = lazy(() => import("./pages/UnderReview"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Bookings = lazy(() => import("./pages/Bookings"))
const BookingDetail = lazy(() => import("./pages/BookingDetail"))
const Workers = lazy(() => import("./pages/Workers"))
const Services = lazy(() => import("./pages/Services"))
const Wallet = lazy(() => import("./pages/Wallet"))
const Profile = lazy(() => import("./pages/Profile"))

/**
 * The service vendor's app, mounted at /services/vendor/* (app/routes.jsx).
 *
 *   /login, /register, /under-review   phone OTP, sign-up with ID documents, waiting for approval
 *   /                                  dashboard with live incoming requests
 *   /bookings, /bookings/:id           every job, and one job from request to paid
 *   /workers                           the vendor's team
 *   /services                          categories served, per-service price and availability
 *   /wallet                            earnings, dues, settlements and withdrawals
 *   /profile                           business details and sign-out
 */
export default function VendorApp() {
  const guard = (el) => (
    <PartnerGuard role="vendor" loginPath={`${BASE}/login`}>
      {el}
    </PartnerGuard>
  )
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="under-review" element={<UnderReview />} />
        <Route index element={guard(<Dashboard />)} />
        <Route path="bookings" element={guard(<Bookings />)} />
        <Route path="bookings/:id" element={guard(<BookingDetail />)} />
        <Route path="workers" element={guard(<Workers />)} />
        <Route path="services" element={guard(<Services />)} />
        <Route path="wallet" element={guard(<Wallet />)} />
        <Route path="profile" element={guard(<Profile />)} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </Suspense>
  )
}
