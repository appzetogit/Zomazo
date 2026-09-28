import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { PartnerGuard } from "../components/partner/PartnerAuth"
import { Spinner } from "../components/partner/ui"
import { BASE } from "./workerApi"

const Login = lazy(() => import("./pages/Login"))
const Register = lazy(() => import("./pages/Register"))
const Home = lazy(() => import("./pages/Home"))
const Jobs = lazy(() => import("./pages/Jobs"))
const JobDetail = lazy(() => import("./pages/JobDetail"))
const Earnings = lazy(() => import("./pages/Earnings"))
const Profile = lazy(() => import("./pages/Profile"))

/**
 * The service worker's app, mounted at /services/worker/* (app/routes.jsx).
 *
 *   /login, /register    phone OTP; a new number registers with an Aadhaar photo
 *   /                    duty switch, new requests and today's jobs
 *   /jobs, /jobs/:id     assigned jobs and history; one job from accept to paid
 *   /earnings            wallet, payouts owed by the vendor, withdrawals
 *   /profile             details and sign-out
 */
export default function WorkerApp() {
  const guard = (el) => (
    <PartnerGuard role="worker" loginPath={`${BASE}/login`}>
      {el}
    </PartnerGuard>
  )
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route index element={guard(<Home />)} />
        <Route path="jobs" element={guard(<Jobs />)} />
        <Route path="jobs/:id" element={guard(<JobDetail />)} />
        <Route path="earnings" element={guard(<Earnings />)} />
        <Route path="profile" element={guard(<Profile />)} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </Suspense>
  )
}
