import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { spotlightAdminAPI, listOf, errorOf, KIND_LABEL } from "./api"

const today = () => new Date().toISOString().slice(0, 10)
const EMPTY = { kind: "banner", partnerId: "", title: "", description: "", ctaLink: "", startDate: "", endDate: "", budgetNote: "" }

/**
 * Advertisement > New: an admin makes an ad directly, for one business or (a
 * banner only) platform-wide. It is approved as it is made and goes to the
 * Ads List.
 */
export default function AdminNewAd({ service, businessLabel = "Business", listPath = ".." }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [image, setImage] = useState(null)
  const [q, setQ] = useState("")
  const [partners, setPartners] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setPartners(listOf(await spotlightAdminAPI.partners({ service, q })))
      } catch (err) {
        toast.error(errorOf(err, "Could not load businesses"))
      }
    }, 250)
    return () => clearTimeout(t)
  }, [service, q])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (form.kind === "banner" && !image) return toast.error("A banner needs an image")
    if (form.kind === "listing" && !form.partnerId) return toast.error(`Pick the ${businessLabel.toLowerCase()} to promote`)
    const body = new FormData()
    body.append("service", service)
    Object.entries(form).forEach(([k, v]) => body.append(k, v))
    if (image) body.append("image", image)
    setSaving(true)
    try {
      await spotlightAdminAPI.create(body)
      toast.success("Ad created")
      navigate(listPath, { relative: "path" })
    } catch (err) {
      toast.error(errorOf(err, "Could not create the ad"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <form onSubmit={submit} className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">New Advertisement</h1>
          <p className="text-sm text-slate-500 mt-1">Made here, it is approved at once and runs between its dates.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {["banner", "listing"].map((k) => (
            <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, kind: k }))} className={`py-2 rounded-lg text-sm border ${form.kind === k ? "bg-blue-600 text-white border-blue-600" : "border-slate-300"}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">{businessLabel}</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${businessLabel.toLowerCase()}s`} className="w-full px-3 py-2 border rounded-lg text-sm" />
          <select value={form.partnerId} onChange={set("partnerId")} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{form.kind === "banner" ? "Platform-wide (no business)" : `Pick a ${businessLabel.toLowerCase()}`}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status && p.status !== "approved" ? ` (${p.status})` : ""}</option>)}
          </select>
        </div>
        <input required maxLength={120} value={form.title} onChange={set("title")} placeholder="Title" className="w-full px-3 py-2 border rounded-lg text-sm" />
        <textarea maxLength={500} value={form.description} onChange={set("description")} placeholder="Description (optional)" rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
        {form.kind === "banner" ? (
          <label className="block text-sm">Banner image
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setImage(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Start
            <input type="date" required value={form.startDate} onChange={set("startDate")} className="mt-1 w-full px-3 py-2 border rounded-lg" />
          </label>
          <label className="block text-sm">End
            <input type="date" required min={form.startDate || today()} value={form.endDate} onChange={set("endDate")} className="mt-1 w-full px-3 py-2 border rounded-lg" />
          </label>
        </div>
        <input maxLength={500} value={form.ctaLink} onChange={set("ctaLink")} placeholder="Link when tapped (optional: /path or https://...)" className="w-full px-3 py-2 border rounded-lg text-sm" />
        <input maxLength={200} value={form.budgetNote} onChange={set("budgetNote")} placeholder="Price / budget note (optional)" className="w-full px-3 py-2 border rounded-lg text-sm" />
        <button type="submit" disabled={saving} className="w-full py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">{saving ? "Creating..." : "Create ad"}</button>
      </form>
    </div>
  )
}
