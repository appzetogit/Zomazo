import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowLeft, Megaphone, Trash2 } from "lucide-react"
import { listOf, errorOf, fmtDate, STATE_STYLE, KIND_LABEL } from "./api"

const today = () => new Date().toISOString().slice(0, 10)
const EMPTY = { kind: "banner", title: "", description: "", ctaLink: "", startDate: "", endDate: "", budgetNote: "" }

/**
 * Advertise: a restaurant or seller asks for a banner or a promoted listing
 * and follows what the admin decided. `client` is the panel's own API client
 * at `basePath`, and `contextModule` its session, so each partner uses the sign-in it has.
 */
export default function PartnerAdvertise({ client, basePath, contextModule, onBack }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [image, setImage] = useState(null)
  const [saving, setSaving] = useState(false)
  const cfg = { contextModule }

  const load = async () => {
    setLoading(true)
    try {
      setItems(listOf(await client.get(basePath, cfg)))
    } catch (err) {
      toast.error(errorOf(err, "Could not load your ads"))
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (form.kind === "banner" && !image) return toast.error("A banner needs an image")
    const body = new FormData()
    Object.entries(form).forEach(([k, v]) => body.append(k, v))
    if (image) body.append("image", image)
    setSaving(true)
    try {
      await client.post(basePath, body, cfg)
      toast.success("Request sent. The admin team will review it.")
      setForm(EMPTY)
      setImage(null)
      e.target.reset()
      load()
    } catch (err) {
      toast.error(errorOf(err, "Could not send the request"))
    } finally {
      setSaving(false)
    }
  }

  const withdraw = async (id) => {
    try {
      await client.delete(`${basePath}/${encodeURIComponent(id)}`, cfg)
      toast.success("Withdrawn")
      load()
    } catch (err) {
      toast.error(errorOf(err, "Could not withdraw"))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          {onBack ? <button type="button" onClick={onBack} className="p-2 rounded-full hover:bg-slate-200"><ArrowLeft className="w-5 h-5" /></button> : null}
          <Megaphone className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-slate-900">Advertise</h1>
        </div>

        <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-medium text-slate-900">Ask for an ad</h2>
          <div className="grid grid-cols-2 gap-2">
            {["banner", "listing"].map((k) => (
              <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, kind: k }))} className={`py-2 rounded-lg text-sm border ${form.kind === k ? "bg-blue-600 text-white border-blue-600" : "border-slate-300"}`}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {form.kind === "banner" ? "A picture on the home screen's promotion strip." : "Your business pinned near the top of the list, marked Promoted."}
          </p>
          <input required maxLength={120} value={form.title} onChange={set("title")} placeholder="Title" className="w-full px-3 py-2 border rounded-lg text-sm" />
          <textarea maxLength={500} value={form.description} onChange={set("description")} placeholder="What should the ad say? (optional)" rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
          {form.kind === "banner" ? (
            <label className="block text-sm">Banner image (wide, JPEG / PNG / WebP)
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setImage(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Start
              <input type="date" required min={today()} value={form.startDate} onChange={set("startDate")} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </label>
            <label className="block text-sm">End
              <input type="date" required min={form.startDate || today()} value={form.endDate} onChange={set("endDate")} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </label>
          </div>
          <input maxLength={500} value={form.ctaLink} onChange={set("ctaLink")} placeholder="Link when tapped (optional, https://...)" className="w-full px-3 py-2 border rounded-lg text-sm" />
          <input maxLength={200} value={form.budgetNote} onChange={set("budgetNote")} placeholder="Budget or price note (optional)" className="w-full px-3 py-2 border rounded-lg text-sm" />
          <button type="submit" disabled={saving} className="w-full py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">{saving ? "Sending..." : "Send request"}</button>
        </form>

        <div className="bg-white rounded-xl border border-slate-200">
          <h2 className="font-medium text-slate-900 p-4 border-b border-slate-100">My ads</h2>
          {loading ? <p className="p-6 text-center text-sm text-slate-500">Loading...</p> : null}
          {!loading && items.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No requests yet.</p> : null}
          {items.map((ad) => (
            <div key={ad.id} className="p-4 border-b border-slate-100 flex gap-3">
              {ad.imageUrl ? <img src={ad.imageUrl} alt="" className="w-20 h-12 object-cover rounded" /> : null}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{ad.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATE_STYLE[ad.state] || ""}`}>{ad.state}</span>
                </div>
                <div className="text-xs text-slate-500">{KIND_LABEL[ad.kind]} · {fmtDate(ad.startDate)} – {fmtDate(ad.endDate)}</div>
                {ad.rejectionReason ? <div className="text-xs text-red-600 mt-1">Reason: {ad.rejectionReason}</div> : null}
              </div>
              {ad.status === "pending" ? (
                <button type="button" onClick={() => withdraw(ad.id)} title="Withdraw" className="p-2 rounded hover:bg-slate-100 self-start"><Trash2 className="w-4 h-4 text-slate-500" /></button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
