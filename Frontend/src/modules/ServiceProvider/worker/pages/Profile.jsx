import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { LogOut, Star } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, Field, Shell, Spinner, errorMessage, inputClass } from "../../components/partner/ui"
import { workerNav } from "../nav"
import { BASE, workerApi } from "../workerApi"

// What a worker may change themselves (workerProfileController.updateProfile).
export default function Profile() {
  const navigate = useNavigate()
  const [worker, setWorker] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    workerApi
      .profile()
      .then((res) => {
        const w = res?.worker || {}
        setWorker(w)
        setForm({
          name: w.name || "",
          skills: (w.skills || []).join(", "),
          addressLine1: w.address?.addressLine1 || "",
          city: w.address?.city || "",
          pincode: w.address?.pincode || "",
        })
      })
      .catch((error) => toast.error(errorMessage(error, "Could not load your profile")))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (form.name.trim().length < 2) return toast.error("Enter your name")
    setBusy(true)
    try {
      const res = await workerApi.updateProfile({
        name: form.name.trim(),
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        address: { addressLine1: form.addressLine1.trim(), city: form.city.trim(), pincode: form.pincode.trim() },
      })
      setWorker((w) => ({ ...w, ...(res?.worker || {}) }))
      toast.success("Profile saved")
    } catch (error) {
      toast.error(errorMessage(error, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    await workerApi.logout().catch(() => {})
    navigate(`${BASE}/login`, { replace: true })
  }

  return (
    <Shell title="Profile" nav={workerNav()}>
      {!form ? (
        <Spinner />
      ) : (
        <>
          <Card className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
              {(worker?.name || "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{worker?.name}</p>
              <p className="text-xs text-slate-500">
                +91 {worker?.phone} · {worker?.completedJobs || 0} jobs done
              </p>
            </div>
            {worker?.rating > 0 && (
              <span className="flex items-center gap-1 text-sm font-semibold text-amber-600">
                <Star className="h-4 w-4 fill-current" /> {Number(worker.rating).toFixed(1)}
              </span>
            )}
          </Card>
          {worker?.serviceCategories?.length > 0 && (
            <p className="text-sm text-slate-600">Categories: {worker.serviceCategories.join(", ")}</p>
          )}
          <Card className="space-y-3">
            <Field label="Name">
              <input className={inputClass} value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Skills" hint="Separate with commas, e.g. AC repair, wiring">
              <input className={inputClass} value={form.skills} onChange={set("skills")} />
            </Field>
            <Field label="Address">
              <input className={inputClass} value={form.addressLine1} onChange={set("addressLine1")} />
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
