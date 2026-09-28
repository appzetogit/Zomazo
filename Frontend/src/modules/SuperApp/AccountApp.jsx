import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import ProtectedRoute from "@food/components/ProtectedRoute"
import AccountHub from "./AccountHub"

// The shared screens themselves. They were built inside Food but depend only on
// the platform APIs, so they run here unchanged, outside Food's shell.
const AllOrders = lazy(() => import("@food/pages/user/orders/AllOrders"))
const Support = lazy(() => import("@food/pages/user/profile/Support"))
const Inbox = lazy(() => import("@food/pages/user/Notifications"))
const Wallet = lazy(() => import("@food/pages/user/Wallet"))

/** /account: the customer's account, shared by every service. Signed in only. */
export default function AccountApp() {
  const guard = (el) => (
    <ProtectedRoute requiredRole="user" loginPath="/login">
      <Suspense fallback={null}>{el}</Suspense>
    </ProtectedRoute>
  )
  return (
    <Routes>
      <Route index element={guard(<AccountHub />)} />
      <Route path="orders" element={guard(<AllOrders />)} />
      <Route path="help" element={guard(<Support />)} />
      <Route path="inbox" element={guard(<Inbox />)} />
      <Route path="wallet" element={guard(<Wallet />)} />
      <Route path="*" element={<Navigate to="/account" replace />} />
    </Routes>
  )
}
