import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Search, Wallet, Calendar, Edit, Trash2, Loader2 } from "lucide-react"
import { rewardsAdminAPI } from "@food/api"

/**
 * Admin > Wallet Bonus: "add Rs X or more, get Y extra". Paid once per verified
 * top-up of the customer's one wallet, from any service, as its own wallet row
 * (core/promotions/walletBonus.service.js). When several apply, the one paying
 * most is used. The Shop admin shows this same page.
 */

const blankForm = () => ({
  title: "",
  description: "",
  bonusType: "percentage",
  bonusValue: "",
  minTopup: "",
  maxBonus: "",
  startDate: "",
  endDate: "",
})

const day = (d) => (d ? String(d).slice(0, 10) : "")
const pretty = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "")
const errorText = (err, fallback) => err?.response?.data?.message || fallback

export default function Bonus() {
  const [searchQuery, setSearchQuery] = useState("")
  const [bonuses, setBonuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(blankForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await rewardsAdminAPI.listBonuses()
      setBonuses(res?.data?.data?.items || [])
    } catch (err) {
      toast.error(errorText(err, "Could not load wallet bonuses"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filteredBonuses = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    return query ? bonuses.filter((b) => String(b.title || "").toLowerCase().includes(query)) : bonuses
  }, [bonuses, searchQuery])

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleReset = () => {
    setEditingId(null)
    setFormData(blankForm())
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.title.trim()) return toast.error("Give the bonus a title")
    if (!(Number(formData.bonusValue) > 0)) return toast.error("Enter the bonus amount")
    const body = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      bonusType: formData.bonusType,
      bonusValue: Number(formData.bonusValue),
      minTopup: Number(formData.minTopup) || 0,
      maxBonus: formData.bonusType === "percentage" ? Number(formData.maxBonus) || 0 : 0,
      startDate: formData.startDate || null,
      endDate: formData.endDate || null,
    }
    setSaving(true)
    try {
      if (editingId) await rewardsAdminAPI.updateBonus(editingId, body)
      else await rewardsAdminAPI.createBonus(body)
      toast.success(editingId ? "Wallet bonus saved" : "Wallet bonus created")
      handleReset()
      load()
    } catch (err) {
      toast.error(errorText(err, "Could not save the bonus"))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (b) => {
    setEditingId(b._id)
    setFormData({
      title: b.title || "",
      description: b.description || "",
      bonusType: b.bonusType || "percentage",
      bonusValue: String(b.bonusValue ?? ""),
      minTopup: b.minTopup ? String(b.minTopup) : "",
      maxBonus: b.maxBonus ? String(b.maxBonus) : "",
      startDate: day(b.startDate),
      endDate: day(b.endDate),
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleToggleStatus = async (b) => {
    const status = b.status === "active" ? "paused" : "active"
    setBonuses((list) => list.map((x) => (x._id === b._id ? { ...x, status } : x)))
    try {
      await rewardsAdminAPI.updateBonus(b._id, { status })
    } catch (err) {
      toast.error(errorText(err, "Could not change the status"))
      load()
    }
  }

  const handleDelete = async (b) => {
    if (!window.confirm("Delete this bonus? Bonuses already paid stay in customers' wallets.")) return
    try {
      await rewardsAdminAPI.deleteBonus(b._id)
      setBonuses((list) => list.filter((x) => x._id !== b._id))
      if (editingId === b._id) handleReset()
    } catch (err) {
      toast.error(errorText(err, "Could not delete the bonus"))
    }
  }

  const inputClass = "w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
  const pct = formData.bonusType === "percentage"

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Bonus Setup Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{editingId ? "Edit Wallet Bonus" : "Wallet Bonus Setup"}</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6">
            Paid once per wallet top-up in any app, on top of the money added. When several bonuses apply, the one paying most is used.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Bonus Title <span className="text-red-500">*</span>
                </label>
                <input type="text" maxLength={80} value={formData.title} onChange={(e) => handleInputChange("title", e.target.value)} placeholder="Ex: Add ₹500, get 10%" className={inputClass} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Short Description</label>
                <input type="text" maxLength={300} value={formData.description} onChange={(e) => handleInputChange("description", e.target.value)} placeholder="Ex: Festive top-up offer" className={inputClass} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Bonus Type <span className="text-red-500">*</span>
                </label>
                <select value={formData.bonusType} onChange={(e) => handleInputChange("bonusType", e.target.value)} className={inputClass}>
                  <option value="percentage">Percentage (%)</option>
                  <option value="flat">Amount (₹)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Bonus Amount ({pct ? "%" : "₹"}) <span className="text-red-500">*</span>
                </label>
                <input type="number" min="0" max={pct ? 100 : undefined} value={formData.bonusValue} onChange={(e) => handleInputChange("bonusValue", e.target.value)} placeholder="Ex: 10" className={inputClass} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Minimum Add Money (₹)</label>
                <input type="number" min="0" value={formData.minTopup} onChange={(e) => handleInputChange("minTopup", e.target.value)} placeholder="Ex: 500" className={inputClass} />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Maximum Bonus (₹)</label>
                <input
                  type="number"
                  min="0"
                  disabled={!pct}
                  value={pct ? formData.maxBonus : ""}
                  onChange={(e) => handleInputChange("maxBonus", e.target.value)}
                  placeholder={pct ? "Ex: 100 (blank for no cap)" : "Only for percentage bonuses"}
                  className={`${inputClass} disabled:bg-slate-100`}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date</label>
                <div className="relative">
                  <input type="date" value={formData.startDate} onChange={(e) => handleInputChange("startDate", e.target.value)} className={`${inputClass} pr-10`} />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Expire Date</label>
                <div className="relative">
                  <input type="date" value={formData.endDate} onChange={(e) => handleInputChange("endDate", e.target.value)} className={`${inputClass} pr-10`} />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-4 mt-6">
              <button type="button" onClick={handleReset} className="px-6 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all">
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button type="submit" disabled={saving} className="px-6 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md disabled:opacity-60 inline-flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? "Save" : "Submit"}
              </button>
            </div>
          </form>
        </div>

        {/* Bonus List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Wallet Bonus List</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">{filteredBonuses.length}</span>
            </div>
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <input
                type="text"
                placeholder="Ex: Search by bonus title"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["SI", "Bonus Title", "Bonus Info", "Bonus Amount", "Started On", "Expires On", "Used", "Status"].map((h) => (
                    <th key={h} className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">{h}</th>
                  ))}
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading && <tr><td colSpan={9} className="px-6 py-10 text-center text-sm text-slate-500">Loading…</td></tr>}
                {!loading && filteredBonuses.length === 0 && (
                  <tr><td colSpan={9} className="px-6 py-10 text-center text-sm text-slate-500">No wallet bonuses yet</td></tr>
                )}
                {!loading && filteredBonuses.map((bonus, i) => (
                  <tr key={bonus._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{i + 1}</td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900">{bonus.title}</span>
                      {bonus.description && <span className="block text-xs text-slate-500">{bonus.description}</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                      Add ₹{bonus.minTopup || 0} or more
                      {bonus.bonusType === "percentage" && bonus.maxBonus > 0 && <span className="block text-xs text-slate-500">up to ₹{bonus.maxBonus}</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                      {bonus.bonusType === "percentage" ? `${bonus.bonusValue}%` : `₹${bonus.bonusValue}`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{pretty(bonus.startDate) || "Now"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{pretty(bonus.endDate) || "No end"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                      {bonus.usedCount || 0}
                      <span className="block text-xs text-slate-500">₹{Number(bonus.totalCredited || 0).toLocaleString("en-IN")} paid</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleStatus(bonus)}
                        title={bonus.status === "active" ? "Pause" : "Resume"}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${bonus.status === "active" ? "bg-blue-600" : "bg-slate-300"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${bonus.status === "active" ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => handleEdit(bonus)} className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(bonus)} className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
