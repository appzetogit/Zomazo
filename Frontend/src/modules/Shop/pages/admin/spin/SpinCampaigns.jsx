import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Loader2, Pencil, Plus, RefreshCw, Trash2, Disc3 } from "lucide-react"
import { toast } from "sonner"
import { spinAdminAPI } from "@store/api"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@store/components/ui/dialog"

const PALETTE = ["#f59e0b", "#8b5cf6", "#6b7280", "#10b981", "#3b82f6", "#ec4899", "#ef4444", "#14b8a6"]

const blankSegment = (i = 0) => ({ label: "", type: "coins", value: 10, weight: 10, color: PALETTE[i % PALETTE.length] })

const blankForm = () => ({
  title: "",
  dailyLimit: 1,
  monthlyCoinBudget: 0,
  startsAt: "",
  endsAt: "",
  segments: [
    { label: "10 Coins", type: "coins", value: 10, weight: 40, color: PALETTE[0] },
    { label: "Better Luck", type: "none", value: 0, weight: 40, color: PALETTE[2] },
    { label: "50 Coins", type: "coins", value: 50, weight: 20, color: PALETTE[3] },
  ],
})

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** ISO date to the value a datetime-local input expects, in the admin's local time. */
const toLocalInput = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const scheduleOf = (c) => {
  const now = Date.now()
  if (c.startsAt && now < new Date(c.startsAt).getTime()) return "scheduled"
  if (c.endsAt && now >= new Date(c.endsAt).getTime()) return "ended"
  return "live"
}

const SCHEDULE_BADGE = {
  scheduled: { label: "Scheduled", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  live: { label: "Live", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ended: { label: "Ended", cls: "bg-slate-100 text-slate-600 border-slate-200" },
}

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null)

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 bg-white"

/** Mirrors the backend's checks so the admin sees problems before saving. */
const validate = (form) => {
  if (!String(form.title || "").trim()) return "Title is required"
  const daily = Number(form.dailyLimit)
  if (!(Number.isInteger(daily) && daily >= 1 && daily <= 10)) return "Daily limit must be a whole number between 1 and 10"
  const budget = Number(form.monthlyCoinBudget)
  if (!(Number.isFinite(budget) && budget >= 0)) return "Monthly budget must be 0 (no cap) or more"
  if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) return "End time must be after start time"
  if (form.segments.length < 2 || form.segments.length > 12) return "A wheel needs between 2 and 12 rewards"
  for (const [i, s] of form.segments.entries()) {
    if (s.type === "coins" && !(Math.floor(Number(s.value)) > 0)) return `Reward ${i + 1}: coins must be a positive whole number`
    if (!(Math.floor(Number(s.weight)) >= 1)) return `Reward ${i + 1}: weight must be at least 1`
  }
  return null
}

const toPayload = (form) => ({
  title: form.title.trim(),
  dailyLimit: Number(form.dailyLimit),
  monthlyCoinBudget: Math.floor(Number(form.monthlyCoinBudget) || 0),
  startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
  endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
  segments: form.segments.map((s) => ({
    label: String(s.label || "").trim(),
    type: s.type,
    value: s.type === "coins" ? Math.floor(Number(s.value)) : 0,
    weight: Math.floor(Number(s.weight)),
    color: s.color,
  })),
})

export default function SpinCampaigns() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [month, setMonth] = useState(currentMonth())
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const res = await spinAdminAPI.listCampaigns()
      setCampaigns(Array.isArray(res?.data?.data) ? res.data.data : [])
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load spin campaigns")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadReport = useCallback(async (m) => {
    setReportLoading(true)
    try {
      const res = await spinAdminAPI.getReport({ month: m })
      setReport(res?.data?.data || null)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load spin report")
    } finally {
      setReportLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    loadReport(month)
  }, [loadReport, month])

  const totalWeight = useMemo(
    () => form.segments.reduce((sum, s) => sum + Math.max(1, Math.floor(Number(s.weight)) || 1), 0),
    [form.segments],
  )

  const openCreate = () => {
    setEditing(null)
    setForm(blankForm())
    setDialogOpen(true)
  }

  const openEdit = (c) => {
    setEditing(c)
    setForm({
      title: c.title || "",
      dailyLimit: c.dailyLimit ?? 1,
      monthlyCoinBudget: c.monthlyCoinBudget ?? 0,
      startsAt: toLocalInput(c.startsAt),
      endsAt: toLocalInput(c.endsAt),
      segments: (c.segments || []).map((s, i) => ({
        label: s.label || "",
        type: s.type === "none" ? "none" : "coins",
        value: s.value ?? 0,
        weight: s.weight ?? 1,
        color: s.color || PALETTE[i % PALETTE.length],
      })),
    })
    setDialogOpen(true)
  }

  const setSegment = (i, field, value) =>
    setForm((f) => ({ ...f, segments: f.segments.map((s, j) => (j === i ? { ...s, [field]: value } : s)) }))

  const save = async (e) => {
    e.preventDefault()
    const error = validate(form)
    if (error) {
      toast.error(error)
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await spinAdminAPI.updateCampaign(editing._id, toPayload(form))
        toast.success("Wheel updated")
      } else {
        await spinAdminAPI.createCampaign(toPayload(form))
        toast.success("Wheel created. Activate it to put it live.")
      }
      setDialogOpen(false)
      loadCampaigns()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save wheel")
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (c) => {
    if (!c.isActive && campaigns.some((x) => x.isActive && x._id !== c._id)) {
      if (!window.confirm("Only one wheel runs at a time. Activating this one switches the current one off. Continue?")) return
    }
    setTogglingId(c._id)
    try {
      await spinAdminAPI.setCampaignActive(c._id, !c.isActive)
      toast.success(c.isActive ? "Wheel switched off" : "Wheel is live")
      await loadCampaigns()
      loadReport(month)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update wheel")
    } finally {
      setTogglingId(null)
    }
  }

  const budget = report?.budget
  const budgetPct = budget?.limit ? Math.min(100, Math.round((budget.used / budget.limit) * 100)) : null

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Disc3 className="h-6 w-6" /> Spin Wheel Campaigns
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Weighted coin rewards for the daily spin. Only one wheel is live at a time.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadCampaigns}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> New wheel
          </button>
        </div>
      </div>

      {/* Campaign list */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-5 py-3 text-left">Wheel</th>
              <th className="px-4 py-3 text-left">Rewards</th>
              <th className="px-4 py-3 text-left">Daily spins</th>
              <th className="px-4 py-3 text-left">Monthly budget</th>
              <th className="px-4 py-3 text-left">Schedule</th>
              <th className="px-4 py-3 text-center">Live</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                </td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                  No wheels yet. Customers see the default wheel until you create one.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c._id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900">{c.title}</p>
                    <p className="text-xs text-slate-500">Updated {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "—"}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(c.segments || []).map((s) => (
                        <span key={s.id ?? s.label} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-700">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color || "#6b7280" }} />
                          {s.label} <span className="text-slate-400">{s.chancePercent != null ? `${s.chancePercent}%` : ""}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{c.dailyLimit ?? 1} / day</td>
                  <td className="px-4 py-4 text-slate-700">{c.monthlyCoinBudget ? `${c.monthlyCoinBudget.toLocaleString()} coins` : "No cap"}</td>
                  <td className="px-4 py-4">
                    {(() => {
                      const b = SCHEDULE_BADGE[c.scheduleStatus || scheduleOf(c)] || SCHEDULE_BADGE.live
                      return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
                    })()}
                    <p className="mt-1 text-xs text-slate-500">
                      {c.startsAt || c.endsAt
                        ? `${fmtWhen(c.startsAt) || "Now"} → ${fmtWhen(c.endsAt) || "No end"}`
                        : "Always on"}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(c)}
                      disabled={togglingId === c._id}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full ${c.isActive ? "bg-emerald-600" : "bg-slate-300"} disabled:opacity-60`}
                      title={c.isActive ? "Switch off" : "Put live"}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${c.isActive ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Report */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <BarChart3 className="h-5 w-5" /> Monthly report
          </p>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        {reportLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        ) : report ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Spins", report.spins],
                ["Players", report.players],
                ["Coins awarded", report.coinsAwarded],
                ["Failed credits", report.failedCredits],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                  <p className={`mt-1 text-xl font-bold ${label === "Failed credits" && value ? "text-rose-600" : "text-slate-900"}`}>
                    {Number(value || 0).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live wheel budget</p>
              {budget ? (
                budget.limit ? (
                  <>
                    <p className="mt-1 text-sm text-slate-700">
                      {budget.used.toLocaleString()} of {budget.limit.toLocaleString()} coins used ({budgetPct}%)
                    </p>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                      <div className={`h-2 rounded-full ${budgetPct >= 90 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${budgetPct}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-700">No cap ({budget.used.toLocaleString()} coins used)</p>
                )
              ) : (
                <p className="mt-1 text-sm text-slate-500">No wheel is live.</p>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="py-2 text-left">Reward</th>
                  <th className="py-2 text-right">Wins</th>
                  <th className="py-2 text-right">Coins</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(report.bySegment || []).length ? (
                  report.bySegment.map((s) => (
                    <tr key={s.label || "unknown"}>
                      <td className="py-2 text-slate-800">{s.label || "—"}</td>
                      <td className="py-2 text-right">{s.wins.toLocaleString()}</td>
                      <td className="py-2 text-right">{s.coins.toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-slate-500">No spins in {report.month}.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-slate-500">No report.</p>
        )}
      </div>

      {/* Create / edit */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <DialogHeader className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <DialogTitle className="text-lg font-semibold text-slate-900">{editing ? "Edit wheel" : "New wheel"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="max-h-[75vh] space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Daily Lucky Wheel" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Spins per customer per day</label>
                <input type="number" min="1" max="10" step="1" className={inputCls} value={form.dailyLimit} onChange={(e) => setForm((f) => ({ ...f, dailyLimit: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Monthly coin budget</label>
                <input type="number" min="0" step="1" className={inputCls} value={form.monthlyCoinBudget} onChange={(e) => setForm((f) => ({ ...f, monthlyCoinBudget: e.target.value }))} />
                <p className="mt-1 text-xs text-slate-500">0 means no cap. Once used up, coin rewards stop paying until next month.</p>
              </div>
              <div className="md:col-span-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Starts at (optional)</label>
                  <input type="datetime-local" className={inputCls} value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Ends at (optional)</label>
                  <input type="datetime-local" className={inputCls} value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
                </div>
                <p className="md:col-span-2 -mt-2 text-xs text-slate-500">Leave empty for no limit. A live wheel only shows to customers inside this window.</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Rewards ({form.segments.length}/12)</p>
                <button
                  type="button"
                  disabled={form.segments.length >= 12}
                  onClick={() => setForm((f) => ({ ...f, segments: [...f.segments, blankSegment(f.segments.length)] }))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add reward
                </button>
              </div>
              <div className="grid grid-cols-[36px_1fr_110px_90px_80px_60px_32px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Color</span><span>Label</span><span>Type</span><span>Coins</span><span>Weight</span><span>Chance</span><span />
              </div>
              {form.segments.map((s, i) => {
                const w = Math.max(1, Math.floor(Number(s.weight)) || 1)
                return (
                  <div key={i} className="grid grid-cols-[36px_1fr_110px_90px_80px_60px_32px] items-center gap-2">
                    <input type="color" value={s.color} onChange={(e) => setSegment(i, "color", e.target.value)} className="h-9 w-9 cursor-pointer rounded border border-slate-300" />
                    <input
                      className={inputCls}
                      value={s.label}
                      placeholder={s.type === "coins" ? `${Math.floor(Number(s.value)) || 0} Coins` : "Better Luck"}
                      onChange={(e) => setSegment(i, "label", e.target.value)}
                    />
                    <select className={inputCls} value={s.type} onChange={(e) => setSegment(i, "type", e.target.value)}>
                      <option value="coins">Coins</option>
                      <option value="none">No reward</option>
                    </select>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className={inputCls}
                      value={s.type === "coins" ? s.value : ""}
                      disabled={s.type !== "coins"}
                      onChange={(e) => setSegment(i, "value", e.target.value)}
                    />
                    <input type="number" min="1" step="1" className={inputCls} value={s.weight} onChange={(e) => setSegment(i, "weight", e.target.value)} />
                    <span className="text-xs font-medium text-slate-600">{Math.round((w / totalWeight) * 1000) / 10}%</span>
                    <button
                      type="button"
                      disabled={form.segments.length <= 2}
                      onClick={() => setForm((f) => ({ ...f, segments: f.segments.filter((_, j) => j !== i) }))}
                      className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                      aria-label="Remove reward"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
              <p className="text-xs text-slate-500">Chance = weight ÷ total weight ({totalWeight}). An empty label is filled in automatically.</p>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create wheel"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
