import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronRight, LogOut, Star, Wrench } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, Field, Shell, Spinner, errorMessage, inputClass } from "../../components/partner/ui"
import { vendorNav } from "../nav"
import { BASE, vendorApi } from "../vendorApi"

/*
 * Business details the vendor may change themselves (vendorProfileController
 * .updateProfile): name, business name, address, service radius. Identity
 * documents were checked at approval and are not editable here.
 */
export default function Profile() {
  const navigate = useNavigate()
  const [vendor, setVendor] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    vendorApi
      .profile()
      .then((res) => {
        const v = res?.vendor || {}
        setVendor(v)
        setForm({
          name: v.name || "",
          businessName: v.businessName || "",
          fullAddress: v.address?.fullAddress || "",
          city: v.address?.city || "",
          pincode: v.address?.pincode || "",
        })
      })
      .catch((error) => toast.error(errorMessage(error, "Could not load your profile")))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (form.name.trim().length < 2) return toast.error("Enter your name")
    setBusy(true)
    try {
      const res = await vendorApi.updateProfile({
        name: form.name.trim(),
        businessName: form.businessName.trim(),
        address: { fullAddress: form.fullAddress.trim(), city: form.city.trim(), pincode: form.pincode.trim() },
      })
      setVendor((v) => ({ ...v, ...(res?.vendor || {}) }))
      toast.success("Profile saved")
    } catch (error) {
      toast.error(errorMessage(error, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    await vendorApi.logout().catch(() => {})
    navigate(`${BASE}/login`, { replace: true })
  }

  return (
    <Shell title="Profile" nav={vendorNav()}>
      {!form ? (
        <Spinner />
      ) : (
        <>
          <Card className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
              {(vendor?.name || "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{vendor?.businessName || vendor?.name}</p>
              <p className="text-xs text-slate-500">+91 {vendor?.phone}</p>
            </div>
            {vendor?.rating > 0 && (
              <span className="flex items-center gap-1 text-sm font-semibold text-amber-600">
                <Star className="h-4 w-4 fill-current" /> {vendor.rating}
              </span>
            )}
          </Card>

          <Link to={`${BASE}/services`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <Wrench className="h-5 w-5 text-emerald-700" />
            <div className="flex-1">
              <p className="font-semibold">My services</p>
              <p className="text-xs text-slate-500">
                {vendor?.service?.length ? vendor.service.join(", ") : "Choose the categories you serve"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </Link>

          <Card className="space-y-3">
            <Field label="Your name">
              <input className={inputClass} value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Business name">
              <input className={inputClass} value={form.businessName} onChange={set("businessName")} />
            </Field>
            <Field label="Address">
              <textarea className={inputClass} rows={2} value={form.fullAddress} onChange={set("fullAddress")} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputClass} placeholder="City" value={form.city} onChange={set("city")} />
              <input className={inputClass} placeholder="Pincode" inputMode="numeric" value={form.pincode} onChange={set("pincode")} />
            </div>
            <Button className="w-full" loading={busy} onClick={save}>
              Save
            </Button>
          </Card>

          <Button variant="secondary" className="w-full text-rose-600" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </>
      )}
    </Shell>
  )
}
