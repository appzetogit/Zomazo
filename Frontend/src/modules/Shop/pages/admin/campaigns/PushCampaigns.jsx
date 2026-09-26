import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, BellRing, Loader2, Pause, Play, Plus, RefreshCw, Settings2, ShieldCheck, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@store/api"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@store/components/ui/dialog"

const AUDIENCES = [
  { value: "all_customers", label: "All customers" },
  { value: "zone", label: "Customers in zone(s)" },
  { value: "channel", label: "Ordered in Quick / Shop recently" },
  { value: "inactive", label: "Inactive for N days" },
  { value: "never_ordered", label: "Never ordered" },
  { value: "coin_balance", label: "Coin balance at least X" },
  { value: "sellers", label: "Sellers" },
  { value: "riders", label: "Riders" },
]

const DEEP_LINKS = [
  { value: "none", label: "No link (open app)" },
  { value: "product", label: "Product (id)" },
  { value: "category", label: "Category (id or slug)" },
  { value: "store", label: "Store (slug)" },
  { value: "offer", label: "Offer (coupon code, optional)" },
  { value: "spin", label: "Spin wheel" },
]

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  scheduled: "bg-amber-50 text-amber-700 border-amber-200",
  sending: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paused: "bg-orange-50 text-orange-700 border-orange-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 bg-white"
const dataOf = (res) => res?.data?.data
const errOf = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—")

/** ISO date to the value a datetime-local input expects, in the admin's local time. */
const toLocalInput = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const blankForm = () => ({
  title: "",
  message: "",
  imageUrl: "",
  audience: { type: "all_customers", zoneIds: [], channel: "quick", days: 30, minCoins: 100 },
  deepLink: { type: "none", value: "" },
  schedule: { type: "now", sendAt: "", frequency: "daily", timeOfDay: "10:00", daysOfWeek: [], startsAt: "", endsAt: "" },
})

const formFromCampaign = (c) => ({
  title: c.title || "",
  message: c.message || "",
  imageUrl: c.imageUrl || "",
  audience: {
    type: c.audience?.type || "all_customers",
    zoneIds: (c.audience?.zoneIds || []).map(String),
    channel: c.audience?.channel || "quick",
    days: c.audience?.days || 30,
    minCoins: c.audience?.minCoins || 100,
  },
  deepLink: { type: c.deepLink?.type || "none", value: c.deepLink?.value || "" },
  schedule: {
    type: c.schedule?.type || "now",
    sendAt: toLocalInput(c.schedule?.sendAt),
    frequency: c.schedule?.frequency || "daily",
    timeOfDay: c.schedule?.timeOfDay || "10:00",
    daysOfWeek: c.schedule?.daysOfWeek || [],
    startsAt: toLocalInput(c.schedule?.startsAt),
    endsAt: toLocalInput(c.schedule?.endsAt),
  },
})

const audiencePayload = (a) => {
  const out = { type: a.type }
  if (a.type === "zone") out.zoneIds = a.zoneIds
  if (a.type === "channel") out.channel = a.channel
  if (a.type === "channel" || a.type === "inactive") out.days = Number(a.days)
  if (a.type === "coin_balance") out.minCoins = Number(a.minCoins)
  return out
}

const toPayload = (form) => ({
  title: form.title.trim(),
  message: form.message.trim(),
  imageUrl: form.imageUrl.trim(),
  audience: audiencePayload(form.audience),
  deepLink: form.deepLink,
  schedule: {
    type: form.schedule.type,
    sendAt: form.schedule.sendAt ? new Date(form.schedule.sendAt).toISOString() : null,
    frequency: form.schedule.frequency,
    timeOfDay: form.schedule.timeOfDay,
    daysOfWeek: form.schedule.daysOfWeek,
    startsAt: form.schedule.startsAt ? new Date(form.schedule.startsAt).toISOString() : null,
    endsAt: form.schedule.endsAt ? new Date(form.schedule.endsAt).toISOString() : null,
  },
})

const validate = (form) => {
  if (!form.title.trim()) return "Title is required"
  if (!form.message.trim()) return "Message is required"
  const a = form.audience
  if (a.type === "zone" && !a.zoneIds.length) return "Pick at least one zone"
  if ((a.type === "channel" || a.type === "inactive") && !(Number.isInteger(Number(a.days)) && Number(a.days) >= 1)) return "Days must be a whole number of at least 1"
  if (a.type === "coin_balance" && !(Number(a.minCoins) >= 1)) return "Minimum coins must be at least 1"
  if (["product", "category", "store"].includes(form.deepLink.type) && !form.deepLink.value.trim()) return `Enter the ${form.deepLink.type} to open`
  const s = form.schedule
  if (s.type === "once" && !s.sendAt) return "Pick when to send"
  if (s.type === "recurring") {
    if (!s.endsAt) return "A recurring campaign needs an end date"
    if (s.frequency === "weekly" && !s.daysOfWeek.length) return "Pick at least one day"
  }
  return null
}

const scheduleLabel = (c) => {
  const s = c.schedule || {}
  if (s.type === "now") return "Send now"
  if (s.type === "once") return `Once, ${fmtWhen(s.sendAt)}`
  const days = s.frequency === "weekly" ? ` (${(s.daysOfWeek || []).map((d) => DAYS[d]).join(", ")})` : ""
  return `${s.frequency === "weekly" ? "Weekly" : "Daily"} at ${s.timeOfDay}${days} until ${fmtWhen(s.endsAt)}`
}

function Stat({ label, value, tone = "text-slate-900", display }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{display ?? Number(value || 0).toLocaleString()}</p>
    </div>
  )
}

/** Opens as a share of pushes sent, e.g. "12.5%" ("—" before anything is sent). */
function openRate(stats = {}) {
  const sent = Number(stats?.sent) || 0
  if (!sent) return "—"
  return `${(Math.round(((Number(stats?.opened) || 0) / sent) * 1000) / 10).toLocaleString()}%`
}

function Builder({ open, onClose, editing, zones, onSaved }) {
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(editing ? formFromCampaign(editing) : blankForm())
      setPreview(null)
    }
  }, [open, editing])

  const set = (path, value) =>
    setForm((f) => {
      const next = structuredClone(f)
      const keys = path.split(".")
      let o = next
      keys.slice(0, -1).forEach((k) => (o = o[k]))
      o[keys.at(-1)] = value
      return next
    })

  // Live audience count, debounced.
  const audienceKey = JSON.stringify(audiencePayload(form.audience))
  useEffect(() => {
    if (!open) return undefined
    const a = form.audience
    if (a.type === "zone" && !a.zoneIds.length) {
      setPreview({ total: 0, optedOut: 0, reachable: 0 })
      return undefined
    }
    let alive = true
    setPreviewing(true)
    const t = setTimeout(() => {
      adminAPI
        .previewPushAudience(JSON.parse(audienceKey))
        .then((res) => alive && setPreview(dataOf(res)))
        .catch(() => alive && setPreview(null))
        .finally(() => alive && setPreviewing(false))
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey, open])

  const save = async (draft = false) => {
    const problem = validate(form)
    if (problem) return toast.error(problem)
    setSaving(true)
    try {
      const body = { ...toPayload(form), draft }
      if (editing) await adminAPI.updatePushCampaign(editing._id, body)
      else await adminAPI.createPushCampaign(body)
      toast.success(editing ? "Campaign updated" : draft ? "Draft saved" : "Campaign scheduled")
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errOf(err, "Could not save the campaign"))
    } finally {
      setSaving(false)
    }
  }

  const a = form.audience
  const s = form.schedule
  const isStaffAudience = a.type === "sellers" || a.type === "riders"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit campaign" : "New push campaign"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-3">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Title</span>
              <input className={inputCls} maxLength={120} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Weekend sale is live" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Message</span>
              <textarea className={inputCls} rows={3} maxLength={500} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Up to 40% off fresh fruit, today only." />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Image URL (optional)</span>
              <input className={inputCls} value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" />
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Audience</h3>
            <select className={inputCls} value={a.type} onChange={(e) => set("audience.type", e.target.value)}>
              {AUDIENCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {a.type === "zone" && (
              <div className="flex flex-wrap gap-2">
                {zones.length === 0 && <p className="text-sm text-slate-500">No zones found.</p>}
                {zones.map((z) => {
                  const id = String(z._id || z.id)
                  const on = a.zoneIds.includes(id)
                  return (
                    <button key={id} type="button"
                      onClick={() => set("audience.zoneIds", on ? a.zoneIds.filter((x) => x !== id) : [...a.zoneIds, id])}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-700"}`}>
                      {z.name || z.zoneName || id}
                    </button>
                  )
                })}
              </div>
            )}
            {a.type === "channel" && (
              <select className={inputCls} value={a.channel} onChange={(e) => set("audience.channel", e.target.value)}>
                <option value="quick">Ordered in Quick</option>
                <option value="shop">Ordered in Shop</option>
                <option value="any">Ordered in either</option>
              </select>
            )}
            {(a.type === "channel" || a.type === "inactive") && (
              <label className="block">
                <span className="text-sm text-slate-600">{a.type === "channel" ? "Within the last (days)" : "No order for at least (days)"}</span>
                <input type="number" min={1} className={inputCls} value={a.days} onChange={(e) => set("audience.days", e.target.value)} />
              </label>
            )}
            {a.type === "coin_balance" && (
              <label className="block">
                <span className="text-sm text-slate-600">Minimum coin balance</span>
                <input type="number" min={1} className={inputCls} value={a.minCoins} onChange={(e) => set("audience.minCoins", e.target.value)} />
              </label>
            )}
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 flex items-center gap-2">
              {previewing && <Loader2 className="h-4 w-4 animate-spin" />}
              {preview ? (
                <span>
                  <b>{preview.reachable.toLocaleString()}</b> will receive it
                  {preview.optedOut > 0 && <> · {preview.optedOut.toLocaleString()} opted out</>} · {preview.total.toLocaleString()} in segment
                </span>
              ) : (
                !previewing && <span>Audience size unavailable</span>
              )}
            </div>
          </section>

          {!isStaffAudience && (
            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900">Opens</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select className={inputCls} value={form.deepLink.type} onChange={(e) => set("deepLink.type", e.target.value)}>
                  {DEEP_LINKS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {["product", "category", "store", "offer"].includes(form.deepLink.type) && (
                  <input className={inputCls} value={form.deepLink.value} onChange={(e) => set("deepLink.value", e.target.value)}
                    placeholder={form.deepLink.type === "offer" ? "WELCOME50" : form.deepLink.type === "store" ? "store-slug" : "id or slug"} />
                )}
              </div>
            </section>
          )}

          <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Schedule</h3>
            <div className="flex flex-wrap gap-2">
              {[["now", "Send now"], ["once", "At a time"], ["recurring", "Recurring"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => set("schedule.type", v)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${s.type === v ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-700"}`}>
                  {l}
                </button>
              ))}
            </div>
            {s.type === "once" && (
              <input type="datetime-local" className={inputCls} value={s.sendAt} onChange={(e) => set("schedule.sendAt", e.target.value)} />
            )}
            {s.type === "recurring" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select className={inputCls} value={s.frequency} onChange={(e) => set("schedule.frequency", e.target.value)}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  <label className="block">
                    <span className="text-xs text-slate-500">Time (store timezone)</span>
                    <input type="time" className={inputCls} value={s.timeOfDay} onChange={(e) => set("schedule.timeOfDay", e.target.value)} />
                  </label>
                </div>
                {s.frequency === "weekly" && (
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((d, i) => {
                      const on = s.daysOfWeek.includes(i)
                      return (
                        <button key={d} type="button"
                          onClick={() => set("schedule.daysOfWeek", on ? s.daysOfWeek.filter((x) => x !== i) : [...s.daysOfWeek, i].sort())}
                          className={`rounded-full border px-3 py-1 text-sm ${on ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-700"}`}>
                          {d}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-slate-500">Starts (optional)</span>
                    <input type="datetime-local" className={inputCls} value={s.startsAt} onChange={(e) => set("schedule.startsAt", e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">Ends</span>
                    <input type="datetime-local" className={inputCls} value={s.endsAt} onChange={(e) => set("schedule.endsAt", e.target.value)} />
                  </label>
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">Quiet hours, the daily per-person cap and customers' opt-outs are always respected.</p>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            {!editing && (
              <button type="button" disabled={saving} onClick={() => save(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">
                Save draft
              </button>
            )}
            <button type="button" disabled={saving} onClick={() => save(false)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 inline-flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save" : s.type === "now" ? "Send" : "Schedule"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatsDialog({ campaign, onClose }) {
  return (
    <Dialog open={Boolean(campaign)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign?.title}</DialogTitle>
        </DialogHeader>
        {campaign && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Targeted" value={campaign.stats?.targeted} />
              <Stat label="Sent" value={campaign.stats?.sent} tone="text-emerald-700" />
              <Stat label="Failed" value={campaign.stats?.failed} tone="text-rose-700" />
              <Stat label="Skipped" value={campaign.stats?.skipped} tone="text-slate-500" />
              <Stat label="Opened" value={campaign.stats?.opened} tone="text-blue-700" />
              <Stat label="Open rate" display={openRate(campaign.stats)} tone="text-blue-700" />
            </div>
            <p className="text-xs text-slate-500">Skipped: opted out of offers, or already at today's push cap. Failed: no registered device or push rejected. Opened: sent pushes tapped (each counted once); open rate is opened ÷ sent.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-2 pr-3">Run</th><th className="pr-3">Targeted</th><th className="pr-3">Sent</th><th className="pr-3">Failed</th><th className="pr-3">Skipped</th><th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {(campaign.runs || []).slice().reverse().map((r) => (
                    <tr key={r.runKey} className="border-b last:border-0">
                      <td className="py-2 pr-3">{fmtWhen(r.startedAt)}</td>
                      <td className="pr-3">{r.targeted}</td><td className="pr-3">{r.sent}</td><td className="pr-3">{r.failed}</td><td className="pr-3">{r.skipped}</td><td>{r.opened || 0}</td>
                    </tr>
                  ))}
                  {!campaign.runs?.length && (
                    <tr><td colSpan={6} className="py-4 text-center text-slate-500">Not sent yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialog({ open, onClose }) {
  const [push, setPush] = useState(null)
  const [guard, setGuard] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    adminAPI.getPushCampaignSettings().then((r) => setPush(dataOf(r))).catch((e) => toast.error(errOf(e, "Could not load settings")))
    adminAPI.getFirstOrderGuardSettings().then((r) => setGuard(dataOf(r))).catch(() => {})
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      await adminAPI.updatePushCampaignSettings({
        dailyCap: Number(push.dailyCap),
        quietHours: push.quietHours,
        batchSize: Number(push.batchSize),
        batchDelayMs: Number(push.batchDelayMs),
      })
      if (guard) await adminAPI.updateFirstOrderGuardSettings({ signals: guard.signals })
      toast.success("Settings saved")
      onClose()
    } catch (err) {
      toast.error(errOf(err, "Could not save settings"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marketing settings</DialogTitle>
        </DialogHeader>
        {!push ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2"><BellRing className="h-4 w-4" /> Push campaigns</h3>
              <label className="block">
                <span className="text-sm text-slate-600">Max marketing pushes per person per day (0 = no cap)</span>
                <input type="number" min={0} className={inputCls} value={push.dailyCap} onChange={(e) => setPush({ ...push, dailyCap: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={push.quietHours.enabled} onChange={(e) => setPush({ ...push, quietHours: { ...push.quietHours, enabled: e.target.checked } })} />
                Quiet hours ({push.timezone})
              </label>
              {push.quietHours.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <input type="time" className={inputCls} value={push.quietHours.start} onChange={(e) => setPush({ ...push, quietHours: { ...push.quietHours, start: e.target.value } })} />
                  <input type="time" className={inputCls} value={push.quietHours.end} onChange={(e) => setPush({ ...push, quietHours: { ...push.quietHours, end: e.target.value } })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500">Batch size</span>
                  <input type="number" min={1} className={inputCls} value={push.batchSize} onChange={(e) => setPush({ ...push, batchSize: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Pause between batches (ms)</span>
                  <input type="number" min={0} className={inputCls} value={push.batchDelayMs} onChange={(e) => setPush({ ...push, batchDelayMs: e.target.value })} />
                </label>
              </div>
            </section>
            {guard && (
              <section className="space-y-2">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> First-order offer: once per…</h3>
                {[["account", "Account"], ["phone", "Verified phone"], ["device", "Device"], ["payment", "Card / UPI used to pay"]].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={guard.signals[k]} onChange={(e) => setGuard({ ...guard, signals: { ...guard.signals, [k]: e.target.checked } })} />
                    {l}
                  </label>
                ))}
              </section>
            )}
            <div className="flex justify-end">
              <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 inline-flex items-center gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function PushCampaigns() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("all")
  const [zones, setZones] = useState([])
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [statsFor, setStatsFor] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getPushCampaigns({ status, limit: 100 })
      setItems(dataOf(res)?.items || [])
    } catch (err) {
      toast.error(errOf(err, "Could not load campaigns"))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    adminAPI
      .getZones()
      .then((res) => {
        const d = dataOf(res)
        setZones(d?.zones || d?.items || (Array.isArray(d) ? d : []))
      })
      .catch(() => {})
  }, [])

  const act = async (c, action) => {
    if (action === "delete" && !window.confirm(`Delete "${c.title}" and its delivery log?`)) return
    if (action === "cancel" && !window.confirm(`Cancel "${c.title}"? It will not send again.`)) return
    try {
      if (action === "delete") await adminAPI.deletePushCampaign(c._id)
      else await adminAPI.setPushCampaignState(c._id, action)
      toast.success("Done")
      load()
    } catch (err) {
      toast.error(errOf(err, "Action failed"))
    }
  }

  const openStats = async (c) => {
    try {
      setStatsFor(dataOf(await adminAPI.getPushCampaign(c._id)))
    } catch (err) {
      toast.error(errOf(err, "Could not load stats"))
    }
  }

  const totals = useMemo(
    () => items.reduce((acc, c) => ({ sent: acc.sent + (c.stats?.sent || 0), targeted: acc.targeted + (c.stats?.targeted || 0) }), { sent: 0, targeted: 0 }),
    [items],
  )

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <BellRing className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Push Campaigns</h1>
              <p className="text-sm text-slate-500 mt-1">
                Segmented, scheduled marketing pushes. {totals.sent.toLocaleString()} sent of {totals.targeted.toLocaleString()} targeted in the listed campaigns.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Settings
            </button>
            <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" onClick={() => { setEditing(null); setBuilderOpen(true) }} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> New campaign
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {["all", "scheduled", "sending", "completed", "paused", "draft", "cancelled"].map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-sm capitalize ${status === s ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-700"}`}>
              {s}
            </button>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-slate-500">No campaigns yet.</p>
          ) : (
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-3">Campaign</th>
                  <th className="pr-3">Audience</th>
                  <th className="pr-3">Schedule</th>
                  <th className="pr-3">Next send</th>
                  <th className="pr-3">Targeted / Sent / Failed</th>
                  <th className="pr-3">Opens</th>
                  <th className="pr-3">Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id} className="border-b last:border-0 align-top">
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-slate-900">{c.title}</p>
                      <p className="text-slate-500 line-clamp-2 max-w-xs">{c.message}</p>
                      {c.link && <p className="text-xs text-blue-600 mt-1">{c.link}</p>}
                    </td>
                    <td className="pr-3 py-3">{c.audienceLabel}</td>
                    <td className="pr-3 py-3">{scheduleLabel(c)}</td>
                    <td className="pr-3 py-3">{["scheduled", "paused"].includes(c.status) ? fmtWhen(c.nextRunAt) : "—"}</td>
                    <td className="pr-3 py-3">
                      {c.stats?.targeted || 0} / <span className="text-emerald-700">{c.stats?.sent || 0}</span> / <span className="text-rose-700">{c.stats?.failed || 0}</span>
                    </td>
                    <td className="pr-3 py-3">
                      <span className="text-blue-700">{c.stats?.opened || 0}</span> <span className="text-slate-500">({openRate(c.stats)})</span>
                    </td>
                    <td className="pr-3 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_BADGE[c.status] || ""}`}>{c.status}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" title="Stats" onClick={() => openStats(c)} className="p-2 rounded-lg hover:bg-slate-100"><BarChart3 className="h-4 w-4" /></button>
                        {["draft", "scheduled", "paused"].includes(c.status) && (c.runCount === 0 || c.schedule?.type === "recurring") && (
                          <button type="button" title="Edit" onClick={() => { setEditing(c); setBuilderOpen(true) }} className="p-2 rounded-lg hover:bg-slate-100 text-xs font-semibold">Edit</button>
                        )}
                        {["scheduled", "sending"].includes(c.status) && (
                          <button type="button" title="Pause" onClick={() => act(c, "pause")} className="p-2 rounded-lg hover:bg-slate-100"><Pause className="h-4 w-4" /></button>
                        )}
                        {["paused", "draft"].includes(c.status) && (
                          <button type="button" title={c.status === "draft" ? "Schedule" : "Resume"} onClick={() => act(c, "resume")} className="p-2 rounded-lg hover:bg-slate-100"><Play className="h-4 w-4" /></button>
                        )}
                        {["draft", "scheduled", "sending", "paused"].includes(c.status) && (
                          <button type="button" title="Cancel" onClick={() => act(c, "cancel")} className="p-2 rounded-lg hover:bg-slate-100 text-rose-600"><XCircle className="h-4 w-4" /></button>
                        )}
                        {c.status !== "sending" && (
                          <button type="button" title="Delete" onClick={() => act(c, "delete")} className="p-2 rounded-lg hover:bg-slate-100 text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Builder open={builderOpen} onClose={() => setBuilderOpen(false)} editing={editing} zones={zones} onSaved={load} />
      <StatsDialog campaign={statsFor} onClose={() => setStatsFor(null)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
