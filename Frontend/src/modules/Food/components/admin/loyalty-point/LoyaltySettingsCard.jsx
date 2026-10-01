import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Settings } from "lucide-react"
import { rewardsAdminAPI } from "@food/api"

/**
 * The loyalty programme's rules (core/loyalty): points earned per Rs 100 of a
 * completed order in any service, and how many points make Rs 1 when a
 * customer converts them into their wallet.
 */
export default function LoyaltySettingsCard() {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    rewardsAdminAPI.getLoyaltySettings()
      .then((res) => {
        const s = res?.data?.data || {}
        setForm({
          isEnabled: Boolean(s.isEnabled),
          pointsPerHundred: String(s.pointsPerHundred ?? 0),
          pointsPerRupee: String(s.pointsPerRupee ?? 10),
          minConvertPoints: String(s.minConvertPoints ?? 100),
        })
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Could not load loyalty settings"))
  }, [])

  if (!form) return null
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      await rewardsAdminAPI.saveLoyaltySettings({
        isEnabled: form.isEnabled,
        pointsPerHundred: Number(form.pointsPerHundred) || 0,
        pointsPerRupee: Number(form.pointsPerRupee) || 1,
        minConvertPoints: Number(form.minConvertPoints) || 1,
      })
      toast.success("Loyalty settings saved")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save loyalty settings")
    } finally {
      setSaving(false)
    }
  }

  const inputClass = "w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Loyalty Point Settings</h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={form.isEnabled} onChange={(e) => set("isEnabled", e.target.checked)} />
          Customers earn points
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Points per ₹100 spent</label>
          <input type="number" min="0" value={form.pointsPerHundred} onChange={(e) => set("pointsPerHundred", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Points that make ₹1</label>
          <input type="number" min="1" value={form.pointsPerRupee} onChange={(e) => set("pointsPerRupee", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Smallest conversion (points)</label>
          <input type="number" min="1" value={form.minConvertPoints} onChange={(e) => set("minConvertPoints", e.target.value)} className={inputClass} />
        </div>
        <div className="flex items-end">
          <button onClick={save} disabled={saving} className="px-6 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
