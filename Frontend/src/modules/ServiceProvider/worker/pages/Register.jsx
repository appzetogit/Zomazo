import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button, Card, Field, PhotoField, Shell, errorMessage, inputClass } from "../../components/partner/ui"
import { BASE, workerApi } from "../workerApi"

/*
 * Worker sign-up after the OTP. The route requires name and email; Aadhaar is
 * taken as a number plus front/back photos (data: URLs, uploaded server side).
 * Registration returns tokens, so the worker lands in the app straight away.
 */
export default function Register() {
  const navigate = useNavigate()
  const signup = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("spWorkerSignup") || "null")
    } catch {
      return null
    }
  })()
  const [form, setForm] = useState({ name: "", email: "", aadharNumber: "" })
  const [docs, setDocs] = useState({ aadharDocument: null, aadharBackDocument: null })
  const [busy, setBusy] = useState(false)

  if (!signup?.verificationToken) return <Navigate to={`${BASE}/login`} replace />

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error("Enter your name")
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return toast.error("Enter a valid email")
    if (!/^\d{12}$/.test(form.aadharNumber)) return toast.error("Aadhaar number must be 12 digits")
    if (!docs.aadharDocument) return toast.error("Add a photo of your Aadhaar card")
    setBusy(true)
    try {
      await workerApi.register({
        name: form.name.trim(),
        email: form.email.trim(),
        aadharNumber: form.aadharNumber,
        phone: signup.phone,
        verificationToken: signup.verificationToken,
        ...docs,
      })
      sessionStorage.removeItem("spWorkerSignup")
      toast.success("Welcome aboard")
      navigate(BASE, { replace: true })
    } catch (error) {
      toast.error(errorMessage(error, "Registration failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Register as a worker" subtitle={`+91 ${signup.phone}`} back={`${BASE}/login`}>
      <form onSubmit={submit} className="space-y-4">
        <Card className="space-y-4">
          <Field label="Full name *">
            <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Email *">
            <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Aadhaar number *">
            <input
              className={inputClass}
              inputMode="numeric"
              maxLength={12}
              value={form.aadharNumber}
              onChange={(e) => setForm((f) => ({ ...f, aadharNumber: e.target.value.replace(/\D/g, "") }))}
            />
          </Field>
          <PhotoField label="Aadhaar front" required value={docs.aadharDocument} onChange={(v) => setDocs((d) => ({ ...d, aadharDocument: v }))} />
          <PhotoField label="Aadhaar back" value={docs.aadharBackDocument} onChange={(v) => setDocs((d) => ({ ...d, aadharBackDocument: v }))} />
        </Card>
        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
    </Shell>
  )
}
