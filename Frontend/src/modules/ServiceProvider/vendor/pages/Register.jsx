import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button, Card, Field, PhotoField, Shell, errorMessage, inputClass } from "../../components/partner/ui"
import { BASE, vendorApi } from "../vendorApi"

/*
 * Vendor sign-up, after the OTP. The backend (vendorAuthController.register)
 * requires name, email, a 12-digit Aadhaar and 10-character PAN, and takes the
 * document photos as data: URLs which it uploads itself. The account is created
 * as pending, so the vendor waits for admin approval rather than signing in.
 */
export default function Register() {
  const navigate = useNavigate()
  const signup = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("spVendorSignup") || "null")
    } catch {
      return null
    }
  })()

  const [form, setForm] = useState({ name: "", businessName: "", email: "", aadhar: "", pan: "" })
  const [docs, setDocs] = useState({ aadharDocument: null, aadharBackDocument: null, panDocument: null })
  const [busy, setBusy] = useState(false)

  if (!signup?.verificationToken) return <Navigate to={`${BASE}/login`} replace />

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error("Enter your name")
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return toast.error("Enter a valid email")
    if (!/^\d{12}$/.test(form.aadhar)) return toast.error("Aadhaar number must be 12 digits")
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan)) return toast.error("Enter a valid PAN, e.g. ABCDE1234F")
    if (!docs.aadharDocument || !docs.panDocument) return toast.error("Add photos of your Aadhaar and PAN")

    setBusy(true)
    try {
      await vendorApi.register({
        ...form,
        name: form.name.trim(),
        phone: signup.phone,
        verificationToken: signup.verificationToken,
        ...docs,
      })
      sessionStorage.removeItem("spVendorSignup")
      // Registration does not sign in: the account waits for approval. The business
      // name is not a register field, so it is kept here for the first profile edit.
      if (form.businessName.trim()) localStorage.setItem("spVendorBusinessName", form.businessName.trim())
      toast.success("Registration submitted")
      navigate(`${BASE}/under-review`, { replace: true })
    } catch (error) {
      toast.error(errorMessage(error, "Registration failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Register as a vendor" subtitle={`+91 ${signup.phone}`} back={`${BASE}/login`}>
      <form onSubmit={submit} className="space-y-4">
        <Card className="space-y-4">
          <Field label="Full name *">
            <input className={inputClass} value={form.name} onChange={set("name")} autoComplete="name" />
          </Field>
          <Field label="Business name" hint="Shown to customers. You can change it later.">
            <input className={inputClass} value={form.businessName} onChange={set("businessName")} />
          </Field>
          <Field label="Email *">
            <input className={inputClass} type="email" value={form.email} onChange={set("email")} autoComplete="email" />
          </Field>
        </Card>
        <Card className="space-y-4">
          <p className="text-sm font-semibold text-slate-800">Identity documents</p>
          <Field label="Aadhaar number *">
            <input
              className={inputClass}
              inputMode="numeric"
              maxLength={12}
              value={form.aadhar}
              onChange={(e) => setForm((f) => ({ ...f, aadhar: e.target.value.replace(/\D/g, "") }))}
            />
          </Field>
          <PhotoField label="Aadhaar front" required value={docs.aadharDocument} onChange={(v) => setDocs((d) => ({ ...d, aadharDocument: v }))} />
          <PhotoField label="Aadhaar back" value={docs.aadharBackDocument} onChange={(v) => setDocs((d) => ({ ...d, aadharBackDocument: v }))} />
          <Field label="PAN *">
            <input
              className={`${inputClass} uppercase`}
              maxLength={10}
              value={form.pan}
              onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
            />
          </Field>
          <PhotoField label="PAN card" required value={docs.panDocument} onChange={(v) => setDocs((d) => ({ ...d, panDocument: v }))} />
        </Card>
        <Button type="submit" loading={busy} className="w-full">
          Submit for approval
        </Button>
      </form>
    </Shell>
  )
}
