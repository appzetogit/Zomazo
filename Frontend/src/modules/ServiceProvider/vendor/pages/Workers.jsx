import { useCallback, useEffect, useState } from "react"
import { Phone, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, Empty, Field, PhotoField, Shell, Spinner, Tabs, errorMessage, inputClass } from "../../components/partner/ui"
import { vendorNav } from "../nav"
import { vendorApi } from "../vendorApi"

/*
 * The vendor's team (vendor-routes/worker.routes.js). A worker joins either by the
 * vendor adding them here (name, phone, Aadhaar number and photo -- all required by
 * the route) or, if they already signed up in the worker app, by linking their
 * phone number.
 */
function AddWorker({ onDone }) {
  const [mode, setMode] = useState("link")
  const [form, setForm] = useState({ name: "", phone: "", email: "", aadhar: "" })
  const [doc, setDoc] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, digits) => (e) => setForm((f) => ({ ...f, [k]: digits ? e.target.value.replace(/\D/g, "") : e.target.value }))

  const submit = async () => {
    if (!/^\d{10}$/.test(form.phone)) return toast.error("Enter a 10-digit phone number")
    setBusy(true)
    try {
      if (mode === "link") {
        await vendorApi.linkWorker(form.phone)
        toast.success("Worker linked")
      } else {
        if (!form.name.trim()) return toast.error("Enter the worker's name")
        if (!/^\d{12}$/.test(form.aadhar)) return toast.error("Aadhaar number must be 12 digits")
        if (!doc) return toast.error("Add a photo of the Aadhaar card")
        await vendorApi.addWorker({
          name: form.name.trim(),
          phone: form.phone,
          email: form.email.trim() || undefined,
          aadhar: { number: form.aadhar, document: doc },
        })
        toast.success("Worker added")
      }
      onDone()
    } catch (error) {
      toast.error(errorMessage(error, "Could not add the worker"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3">
      <Tabs
        tabs={[
          { value: "link", label: "Link existing" },
          { value: "add", label: "Add new" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <Field label="Phone number" hint={mode === "link" ? "The number they signed up with in the worker app." : undefined}>
        <input className={inputClass} inputMode="numeric" maxLength={10} value={form.phone} onChange={set("phone", true)} />
      </Field>
      {mode === "add" && (
        <>
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Email (optional)">
            <input className={inputClass} type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Aadhaar number">
            <input className={inputClass} inputMode="numeric" maxLength={12} value={form.aadhar} onChange={set("aadhar", true)} />
          </Field>
          <PhotoField label="Aadhaar photo" required value={doc} onChange={setDoc} />
        </>
      )}
      <Button className="w-full" loading={busy} onClick={submit}>
        {mode === "link" ? "Link worker" : "Add worker"}
      </Button>
    </Card>
  )
}

export default function Workers() {
  const [workers, setWorkers] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await vendorApi.workers({ limit: 100 })
      setWorkers(res?.data || [])
    } catch (error) {
      setWorkers([])
      toast.error(errorMessage(error, "Could not load workers"))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (w) => {
    const next = w.status === "inactive" ? "active" : "inactive"
    try {
      await vendorApi.updateWorker(w._id, { status: next })
      load()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const remove = async (w) => {
    if (!window.confirm(`Remove ${w.name} from your team?`)) return
    try {
      await vendorApi.removeWorker(w._id)
      toast.success("Worker removed")
      load()
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove the worker"))
    }
  }

  return (
    <Shell
      title="Workers"
      nav={vendorNav()}
      right={
        <Button variant="ghost" className="min-h-0 px-2 py-1" onClick={() => setAdding((v) => !v)}>
          <UserPlus className="h-4 w-4" /> {adding ? "Close" : "Add"}
        </Button>
      }
    >
      {adding && (
        <AddWorker
          onDone={() => {
            setAdding(false)
            load()
          }}
        />
      )}
      {!workers ? (
        <Spinner />
      ) : workers.length ? (
        <div className="space-y-2">
          {workers.map((w) => (
            <Card key={w._id} className="flex items-center gap-3 p-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${w.isOnline ? "bg-emerald-500" : "bg-slate-300"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{w.name}</p>
                <p className="text-xs text-slate-500">
                  {w.phone} · {w.completedJobs || 0} jobs · {w.rating ? `${w.rating} ★` : "no rating"}
                </p>
                {w.approvalStatus && w.approvalStatus !== "approved" && (
                  <p className="text-xs text-amber-700">Approval: {w.approvalStatus}</p>
                )}
              </div>
              <button type="button" onClick={() => toggle(w)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium">
                {w.status === "inactive" ? "Activate" : "Pause"}
              </button>
              <a href={`tel:${w.phone}`} className="p-1.5 text-emerald-700" aria-label={`Call ${w.name}`}>
                <Phone className="h-4 w-4" />
              </a>
              <button type="button" onClick={() => remove(w)} className="p-1.5 text-rose-600" aria-label={`Remove ${w.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </Card>
          ))}
        </div>
      ) : (
        <Empty title="No workers yet" hint="Add your team so you can assign them jobs." />
      )}
    </Shell>
  )
}
