import { useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { toast } from "sonner"
import { Button, Card, Field, errorMessage, inputClass } from "./ui"

/**
 * Lets a partner screen render only with a live session for that role.
 *
 * Mirrors the shared ProtectedRoute's rule -- an expired access token still counts
 * while a refresh token exists, because services/api.js refreshes on the first 401
 * -- but redirects to the in-master login path instead of the standalone one.
 */
export function PartnerGuard({ role, loginPath, children }) {
  const location = useLocation()
  const token = localStorage.getItem(`${role}AccessToken`) || sessionStorage.getItem(`${role}AccessToken`)
  const refresh = localStorage.getItem(`${role}RefreshToken`) || sessionStorage.getItem(`${role}RefreshToken`)

  let ok = false
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
      ok = String(payload.role || "").toLowerCase() === role && (payload.exp * 1000 > Date.now() || Boolean(refresh))
    } catch {
      ok = false
    }
  }
  if (!ok) return <Navigate to={loginPath} replace state={{ from: location.pathname }} />
  return children
}

/**
 * Phone, then a 6-digit OTP. What happens after a correct OTP is the caller's
 * business (`onVerify`), because vendors and workers branch differently: a new
 * number goes to registration, a vendor under review goes to a waiting screen.
 */
export function OtpForm({ onSendOtp, onVerify, accent = "Sign in" }) {
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [stage, setStage] = useState("phone")
  const [busy, setBusy] = useState(false)

  const send = async (e) => {
    e?.preventDefault()
    if (!/^\d{10}$/.test(phone)) return toast.error("Enter your 10-digit mobile number")
    setBusy(true)
    try {
      const stop = await onSendOtp(phone)
      if (stop) return
      setStage("otp")
      toast.success("OTP sent")
    } catch (error) {
      toast.error(errorMessage(error, "Could not send the OTP"))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(otp)) return toast.error("Enter the 6-digit OTP")
    setBusy(true)
    try {
      await onVerify(phone, otp)
    } catch (error) {
      toast.error(errorMessage(error, "Could not verify the OTP"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      {stage === "phone" ? (
        <form onSubmit={send} className="space-y-4">
          <Field label="Mobile number">
            <div className="flex items-center gap-2">
              <span className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-[15px] text-slate-600">+91</span>
              <input
                className={inputClass}
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="10-digit number"
              />
            </div>
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            Get OTP
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-slate-600">
            Enter the OTP sent to <span className="font-semibold text-slate-900">+91 {phone}</span>
          </p>
          <input
            className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <Button type="submit" loading={busy} className="w-full">
            {accent}
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-slate-500" onClick={() => { setStage("phone"); setOtp("") }}>
              Change number
            </button>
            <button type="button" className="font-medium text-emerald-700" disabled={busy} onClick={send}>
              Resend OTP
            </button>
          </div>
        </form>
      )}
    </Card>
  )
}
