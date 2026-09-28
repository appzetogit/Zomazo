import { Link, useNavigate } from "react-router-dom"
import { HardHat } from "lucide-react"
import { toast } from "sonner"
import { OtpForm } from "../../components/partner/PartnerAuth"
import { BASE, workerApi } from "../workerApi"

/*
 * A known number signs straight in (workerAuthController.verifyLogin issues tokens
 * even while the account awaits approval -- the worker finishes onboarding inside
 * the app); a new number gets a verificationToken and goes to registration.
 */
export default function Login() {
  const navigate = useNavigate()

  const onVerify = async (phone, otp) => {
    const res = await workerApi.verifyLogin(phone, otp)
    if (res?.isNewUser) {
      sessionStorage.setItem("spWorkerSignup", JSON.stringify({ phone, verificationToken: res.verificationToken }))
      navigate(`${BASE}/register`, { replace: true })
    } else if (res?.accessToken) {
      toast.success(`Welcome${res.worker?.name ? `, ${res.worker.name}` : ""}`)
      navigate(BASE, { replace: true })
    } else {
      toast.error(res?.message || "Could not sign you in")
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            <HardHat className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Service Worker</h1>
            <p className="text-sm text-slate-600">Sign in to get jobs</p>
          </div>
        </div>
        <OtpForm onSendOtp={async (phone) => { await workerApi.sendOtp(phone); return false }} onVerify={onVerify} />
        <p className="mt-6 text-center text-sm text-slate-500">
          Run a service business?{" "}
          <Link to="/services/vendor/login" className="font-semibold text-emerald-700">
            Vendor sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
