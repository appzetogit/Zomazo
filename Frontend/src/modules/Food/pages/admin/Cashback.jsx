import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Search, Edit, Trash2, Calendar, RefreshCw, Loader2 } from "lucide-react"
import { rewardsAdminAPI } from "@food/api"
import { ECOMMERCE_ENABLED, SERVICE_PROVIDER_ENABLED } from "@/config/features"

/**
 * Admin > Cashback: the platform's cashback offers. Paid into the customer's one
 * wallet when an order in a service the offer names is delivered (a ride
 * completed), once per order; a return takes it back pro rata
 * (core/promotions/cashback.service.js). The Shop admin shows this same page.
 */

// Services whose completed orders pay cashback (Backend rewardsAdmin.service.js).
const SERVICES = [
  { key: "food", label: "Food" },
  { key: "quickCommerce", label: "Quick & Medical" },
  { key: "taxi", label: "Rides" },
  ...(ECOMMERCE_ENABLED ? [{ key: "ecommerce", label: "Shop" }] : []),
  ...(SERVICE_PROVIDER_ENABLED ? [{ key: "serviceProvider", label: "Services" }] : []),
]
const LABEL = Object.fromEntries(SERVICES.map((s) => [s.key, s.label]))

const blankForm = (services) => ({
  title: "",
  services,
  cashbackType: "percentage",
  cashbackValue: "",
  minOrderValue: "",
  maxCashback: "",
  startDate: "",
  endDate: "",
  perUserLimit: "",
})

const day = (d) => (d ? String(d).slice(0, 10) : "")
const pretty = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "")
const errorText = (err, fallback) => err?.response?.data?.message || fallback

export default function Cashback({ defaultServices = ["food"] }) {
  const [searchQuery, setSearchQuery] = useState("")
  const [cashbackType, setCashbackType] = useState("all")
  const [cashbacks, setCashbacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState(() => blankForm(defaultServices))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await rewardsAdminAPI.listCashback()
      setCashbacks(res?.data?.data?.items || [])
    } catch (err) {
      toast.error(errorText(err, "Could not load cashback offers"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filteredCashbacks = useMemo(() => {
    let result = cashbacks
    if (cashbackType !== "all") result = result.filter((cb) => cb.cashbackType === cashbackType)
    const query = searchQuery.toLowerCase().trim()
    if (query) result = result.filter((cb) => String(cb.title || "").toLowerCase().includes(query))
    return result
  }, [cashbacks, searchQuery, cashbackType])

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const toggleService = (key) => {
    setFormData((f) => ({
      ...f,
      services: f.services.includes(key) ? f.services.filter((s) => s !== key) : [...f.services, key],
    }))
  }

  const handleReset = () => {
    setEditingId(null)
    setFormData(blankForm(defaultServices))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.title.trim()) return toast.error("Give the offer a title")
    if (!formData.services.length) return toast.error("Pick at least one service")
    if (!(Number(formData.cashbackValue) > 0)) return toast.error("Enter the cashback amount")
    const body = {
      title: formData.title.trim(),
      services: formData.services,
      cashbackType: formData.cashbackType,
      cashbackValue: Number(formData.cashbackValue),
      minOrderValue: Number(formData.minOrderValue) || 0,
      maxCashback: formData.cashbackType === "percentage" ? Number(formData.maxCashback) || 0 : 0,
      perUserLimit: Number(formData.perUserLimit) || 0,
      startDate: formData.startDate || null,
      endDate: formData.endDate || null,
    }
    setSaving(true)
    try {
      if (editingId) await rewardsAdminAPI.updateCashback(editingId, body)
      else await rewardsAdminAPI.createCashback(body)
      toast.success(editingId ? "Cashback offer saved" : "Cashback offer created")
      handleReset()
      load()
    } catch (err) {
      toast.error(errorText(err, "Could not save the offer"))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (cb) => {
    setEditingId(cb._id)
    setFormData({
      title: cb.title || "",
      services: cb.services || [],
      cashbackType: cb.cashbackType || "percentage",
      cashbackValue: String(cb.cashbackValue ?? ""),
      minOrderValue: cb.minOrderValue ? String(cb.minOrderValue) : "",
      maxCashback: cb.maxCashback ? String(cb.maxCashback) : "",
      startDate: day(cb.startDate),
      endDate: day(cb.endDate),
      perUserLimit: cb.perUserLimit ? String(cb.perUserLimit) : "",
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleToggleStatus = async (cb) => {
    const status = cb.status === "active" ? "paused" : "active"
    setCashbacks((list) => list.map((x) => (x._id === cb._id ? { ...x, status } : x)))
    try {
      await rewardsAdminAPI.updateCashback(cb._id, { status })
    } catch (err) {
      toast.error(errorText(err, "Could not change the status"))
      load()
    }
  }

  const handleDelete = async (cb) => {
    if (!window.confirm("Delete this cashback offer? Cashback already paid stays in customers' wallets.")) return
    try {
      await rewardsAdminAPI.deleteCashback(cb._id)
      setCashbacks((list) => list.filter((x) => x._id !== cb._id))
      if (editingId === cb._id) handleReset()
    } catch (err) {
      toast.error(errorText(err, "Could not delete the offer"))
    }
  }

  const unit = formData.cashbackType === "percentage" ? "%" : "₹"
  const inputClass = "w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Create Cashback Offer Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{editingId ? "Edit Cashback Offer" : "Create Cashback Offer"}</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6">
            Paid into the customer's wallet once per delivered order, in every service you pick. When several offers apply, the one paying most is used.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  maxLength={80}
                  onChange={(e) => handleInputChange("title", e.target.value)}
                  placeholder="Ex: Weekend cashback"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Services <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {SERVICES.map((s) => (
                    <label
                      key={s.key}
                      className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                        formData.services.includes(s.key) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-700"
                      }`}
                    >
                      <input type="checkbox" className="sr-only" checked={formData.services.includes(s.key)} onChange={() => toggleService(s.key)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Cashback Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.cashbackType}
                  onChange={(e) => handleInputChange("cashbackType", e.target.value)}
                  className={inputClass}
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="flat">Amount (₹)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Cashback Amount ({unit}) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max={formData.cashbackType === "percentage" ? 100 : undefined}
                  value={formData.cashbackValue}
                  onChange={(e) => handleInputChange("cashbackValue", e.target.value)}
                  placeholder="Ex: 10"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Minimum Order (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.minOrderValue}
                  onChange={(e) => handleInputChange("minOrderValue", e.target.value)}
                  placeholder="Ex: 199"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Maximum Cashback (₹)</label>
                <input
                  type="number"
                  min="0"
                  disabled={formData.cashbackType !== "percentage"}
                  value={formData.cashbackType === "percentage" ? formData.maxCashback : ""}
                  onChange={(e) => handleInputChange("maxCashback", e.target.value)}
                  placeholder={formData.cashbackType === "percentage" ? "Ex: 100 (blank for no cap)" : "Only for percentage offers"}
                  className={`${inputClass} disabled:bg-slate-100`}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => handleInputChange("startDate", e.target.value)}
                    className={`${inputClass} pr-10`}
                  />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">End Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => handleInputChange("endDate", e.target.value)}
                    className={`${inputClass} pr-10`}
                  />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Limit For Same Customer</label>
                <input
                  type="number"
                  min="0"
                  value={formData.perUserLimit}
                  onChange={(e) => handleInputChange("perUserLimit", e.target.value)}
                  placeholder="Ex: 5 (blank for unlimited)"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-4 mt-6">
              <button
                type="button"
                onClick={handleReset}
                className="px-6 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md disabled:opacity-60 inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? "Save" : "Submit"}
              </button>
            </div>
          </form>
        </div>

        {/* Cashback List Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Cashback List</h2>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                {filteredCashbacks.length}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={cashbackType}
                onChange={(e) => setCashbackType(e.target.value)}
                className="px-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="all">All CashBacks</option>
                <option value="percentage">Percentage</option>
                <option value="flat">Amount</option>
              </select>

              <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                <input
                  type="text"
                  placeholder="Ex: Search by title"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">SI</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">CashBack Type</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Duration</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Total Used</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading && (
                  <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-slate-500">Loading…</td></tr>
                )}
                {!loading && filteredCashbacks.length === 0 && (
                  <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-slate-500">No cashback offers yet</td></tr>
                )}
                {!loading && filteredCashbacks.map((cashback, i) => (
                  <tr key={cashback._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-700">{i + 1}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900">{cashback.title}</span>
                      <span className="block text-xs text-slate-500">{(cashback.services || []).map((s) => LABEL[s] || s).join(", ")}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-700">{cashback.cashbackType === "percentage" ? "Percentage" : "Amount"}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900">
                        {cashback.cashbackType === "percentage" ? `${cashback.cashbackValue}%` : `₹${cashback.cashbackValue}`}
                      </span>
                      {cashback.cashbackType === "percentage" && cashback.maxCashback > 0 && (
                        <span className="block text-xs text-slate-500">up to ₹{cashback.maxCashback}</span>
                      )}
                      {cashback.minOrderValue > 0 && <span className="block text-xs text-slate-500">min order ₹{cashback.minOrderValue}</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-700">
                        {cashback.startDate || cashback.endDate
                          ? `${pretty(cashback.startDate) || "Now"} – ${pretty(cashback.endDate) || "No end"}`
                          : "Always"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-700">{cashback.usedCount || 0}</span>
                      <span className="block text-xs text-slate-500">₹{Number(cashback.totalCredited || 0).toLocaleString("en-IN")} paid</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleStatus(cashback)}
                        title={cashback.status === "active" ? "Pause" : "Resume"}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          cashback.status === "active" ? "bg-blue-600" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            cashback.status === "active" ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(cashback)}
                          className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(cashback)}
                          className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
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
