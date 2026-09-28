import { Link, useNavigate } from "react-router-dom"
import { Wrench } from "lucide-react"
import { toast } from "sonner"
import { OtpForm } from "../../components/partner/PartnerAuth"
import { BASE, vendorApi } from "../vendorApi"

/*
 * One door for new and returning vendors, as the backend's verify-login is built:
 * a known, approved number gets tokens; a new number gets a short-lived
 * verificationToken to finish registration with; a number still under review gets
 * neither (send-otp even skips the SMS for it), so it goes to the waiting screen.
 */
export default function Login() {
  const navigate = useNavigate()

  const onSendOtp = async (phone) => {
    const res = await vendorApi.sendOtp(phone)
    if (res?.vendor?.adminApproval === "pending") {
      navigate(`${BASE}/under-review`, { replace: true })
      return true
    }
    return false
  }

  const onVerify = async (phone, otp) => {
    const res = await vendorApi.verifyLogin(phone, otp)
    if (res?.vendor?.adminApproval === "pending") {
      navigate(`${BASE}/under-review`, { replace: true })
    } else if (res?.isNewUser) {
      sessionStorage.setItem("spVendorSignup", JSON.stringify({ phone, verificationToken: res.verificationToken }))
      navigate(`${BASE}/register`, { replace: true })
    } else if (res?.accessToken) {
      toast.success(`Welcome back${res.vendor?.name ? `, ${res.vendor.name}` : ""}`)
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
            <Wrench className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Service Partner</h1>
            <p className="text-sm text-slate-600">Vendor sign in or registration</p>
          </div>
        </div>
        <OtpForm onSendOtp={onSendOtp} onVerify={onVerify} />
        <p className="mt-6 text-center text-sm text-slate-500">
          Working for a vendor?{" "}
          <Link to="/services/worker/login" className="font-semibold text-emerald-700">
            Worker sign in
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link to="/partner" className="text-slate-500 underline-offset-2 hover:underline">
            Other partner types
          </Link>
        </p>
      </div>
    </div>
  )
}
