import { useState, useEffect } from "react"
import { 
  Coins, 
  Settings, 
  TrendingUp, 
  UserCheck, 
  Search, 
  PlusCircle, 
  MinusCircle, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  ShieldAlert, 
  RefreshCw,
  Wallet,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react"
import { toast } from "sonner"
import { coinsAPI } from "@/services/api"
import { Button } from "@store/components/ui/button"
import { Input } from "@store/components/ui/input"
import { Switch } from "@store/components/ui/switch"

export default function CoinsManagement() {
  const [activeTab, setActiveTab] = useState("settings")
  const [loading, setLoading] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)

  // Tab 1: Settings
  const [settings, setSettings] = useState({
    isEnabled: true,
    redeemPercent: 80,
    expiryDays: 90,
    maxOrderPercent: 50,
    coinValue: 1,
  })
  const [savingSettings, setSavingSettings] = useState(false)

  // Tab 2: Report
  const [report, setReport] = useState({
    credited: 0,
    creditedSpendable: 0,
    redeemed: 0,
    expired: 0,
    removedByAdmin: 0,
    outstandingUsable: 0,
    outstandingValue: 0,
  })

  // Tab 3: Adjustment
  const [adjustForm, setAdjustForm] = useState({
    userId: "",
    amount: "",
    type: "credit",
    reason: "",
  })
  const [adjusting, setAdjusting] = useState(false)

  // Tab 4: User Ledger
  const [searchUserId, setSearchUserId] = useState("")
  const [userLedger, setUserLedger] = useState(null)
  const [searchingLedger, setSearchingLedger] = useState(false)

  useEffect(() => {
    fetchSettings()
    fetchReport()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const res = await coinsAPI.getSettings()
      if (res?.data?.data) {
        setSettings(res.data.data)
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load coin settings")
    } finally {
      setLoading(false)
    }
  }

  const fetchReport = async () => {
    try {
      setReportLoading(true)
      const res = await coinsAPI.getReport()
      if (res?.data?.data) {
        setReport(res.data.data)
      }
    } catch (err) {
      toast.error("Failed to load coin liability report")
    } finally {
      setReportLoading(false)
    }
  }

  const handleSaveSettings = async (e) => {
    e.preventDefault()
    try {
      setSavingSettings(true)
      await coinsAPI.updateSettings({
        isEnabled: settings.isEnabled,
        redeemPercent: Number(settings.redeemPercent),
        expiryDays: Number(settings.expiryDays),
        maxOrderPercent: Number(settings.maxOrderPercent),
        coinValue: Number(settings.coinValue),
      })
      toast.success("Coin settings saved successfully!")
      fetchReport()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update settings")
    } finally {
      setSavingSettings(false)
    }
  }

  const handleAdjustCoins = async (e) => {
    e.preventDefault()
    if (!adjustForm.userId.trim()) {
      return toast.error("Please enter a valid User ID")
    }
    const numAmount = Math.abs(Number(adjustForm.amount))
    if (!numAmount || numAmount <= 0) {
      return toast.error("Please enter a positive coin amount")
    }
    if (!adjustForm.reason.trim()) {
      return toast.error("A reason is strictly required for audit logs")
    }

    try {
      setAdjusting(true)
      const amountToSend = adjustForm.type === "credit" ? numAmount : -numAmount
      await coinsAPI.adjustCoins({
        userId: adjustForm.userId.trim(),
        amount: amountToSend,
        reason: adjustForm.reason.trim(),
      })
      toast.success(
        `Successfully ${adjustForm.type === "credit" ? "credited" : "debited"} ${numAmount} coins!`
      )
      setAdjustForm({ userId: "", amount: "", type: "credit", reason: "" })
      fetchReport()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Adjustment failed")
    } finally {
      setAdjusting(false)
    }
  }

  const handleSearchUserLedger = async (e) => {
    e.preventDefault()
    if (!searchUserId.trim()) return
    try {
      setSearchingLedger(true)
      const res = await coinsAPI.getUserLedger(searchUserId.trim())
      setUserLedger(res?.data?.data || { entries: [], total: 0 })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Customer not found or has no coins")
      setUserLedger(null)
    } finally {
      setSearchingLedger(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-8 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold uppercase tracking-wider mb-3">
              <Coins className="w-4 h-4 text-amber-200" /> Promotional Liability Ledger
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Platform Coins Engine</h1>
            <p className="mt-2 text-white/90 text-sm max-w-2xl leading-relaxed">
              Configure promotional coin rules, enforce the 80% refund spendability limit,
              manage the 50% order usage cap, and monitor total financial liability.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { fetchSettings(); fetchReport(); }}
              className="px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md text-sm font-semibold transition-all flex items-center gap-2 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${reportLoading ? "animate-spin" : ""}`} />
              Sync Data
            </button>
          </div>
        </div>
      </div>

      {/* Modern Tabs Navigation */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 space-x-2">
        {[
          { id: "settings", label: "Rules & Settings", icon: Settings },
          { id: "report", label: "Liability Report", icon: TrendingUp },
          { id: "adjust", label: "Manual Adjustment", icon: PlusCircle },
          { id: "ledger", label: "User Ledgers", icon: UserCheck },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium rounded-t-xl transition-all border-b-2 -mb-[2px] ${
                isActive
                  ? "border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50/50 dark:bg-orange-950/20"
                  : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* TAB 1: RULES & SETTINGS */}
      {activeTab === "settings" && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-6 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Platform Coin Economy Rules</h2>
              <p className="text-sm text-gray-500 mt-1">Configure global redemption terms, expiry timelines, and order caps.</p>
            </div>
            <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/60 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Coins Active</span>
              <Switch
                checked={settings.isEnabled}
                onCheckedChange={(val) => setSettings((s) => ({ ...s, isEnabled: val }))}
              />
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 80% Rule */}
              <div className="p-5 rounded-xl border border-amber-200/80 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-amber-950 dark:text-amber-300">
                    Refund Spendable Cap (%)
                  </label>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-200/60 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                    SOW Rule B2
                  </span>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.redeemPercent}
                  onChange={(e) => setSettings({ ...settings, redeemPercent: e.target.value })}
                  className="bg-white dark:bg-gray-800 font-semibold text-lg"
                />
                <p className="text-xs text-amber-800 dark:text-amber-400">
                  Fixed for each credited lot. 1,000 refund coins gives <strong>{settings.redeemPercent * 10}</strong> spendable coins.
                  Remaining {100 - settings.redeemPercent}% is non-redeemable promotional holding.
                </p>
              </div>

              {/* Order Max Cap */}
              <div className="p-5 rounded-xl border border-blue-200/80 bg-blue-50/40 dark:bg-blue-950/10 dark:border-blue-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-blue-950 dark:text-blue-300">
                    Max Order Payable (%)
                  </label>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-200/60 text-blue-900 dark:bg-blue-900/60 dark:text-blue-200">
                    SOW Rule B3
                  </span>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.maxOrderPercent}
                  onChange={(e) => setSettings({ ...settings, maxOrderPercent: e.target.value })}
                  className="bg-white dark:bg-gray-800 font-semibold text-lg"
                />
                <p className="text-xs text-blue-800 dark:text-blue-400">
                  Maximum percentage of an order total that can be paid using coins. (Default: 50%).
                </p>
              </div>

              {/* Expiry Days */}
              <div className="p-5 rounded-xl border border-purple-200/80 bg-purple-50/40 dark:bg-purple-950/10 dark:border-purple-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-purple-950 dark:text-purple-300">
                    Coin Expiration Period (Days)
                  </label>
                  <Clock className="w-4 h-4 text-purple-600" />
                </div>
                <Input
                  type="number"
                  min="1"
                  value={settings.expiryDays}
                  onChange={(e) => setSettings({ ...settings, expiryDays: e.target.value })}
                  className="bg-white dark:bg-gray-800 font-semibold text-lg"
                />
                <p className="text-xs text-purple-800 dark:text-purple-400">
                  Each credited lot expires after this many days. Oldest unexpired coins are consumed first (FIFO).
                </p>
              </div>

              {/* Coin to INR Rate */}
              <div className="p-5 rounded-xl border border-emerald-200/80 bg-emerald-50/40 dark:bg-emerald-950/10 dark:border-emerald-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-emerald-950 dark:text-emerald-300">
                    Coin Value (₹ per coin)
                  </label>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-200/60 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200">
                    1:1 Peg
                  </span>
                </div>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={settings.coinValue}
                  onChange={(e) => setSettings({ ...settings, coinValue: e.target.value })}
                  className="bg-white dark:bg-gray-800 font-semibold text-lg"
                />
                <p className="text-xs text-emerald-800 dark:text-emerald-400">
                  1 coin = ₹{settings.coinValue || 1}. Used across cart checkout and financial reconciliation.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                type="submit"
                disabled={savingSettings}
                className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-8 py-2.5 font-semibold rounded-xl shadow-md transition-all"
              >
                {savingSettings ? "Saving Changes..." : "Save Settings"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: LIABILITY REPORT */}
      {activeTab === "report" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Outstanding Liability */}
            <div className="bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-2xl p-6 shadow-md relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-white/80 text-xs font-semibold uppercase tracking-wider">Outstanding Liability</p>
                <h3 className="text-3xl font-extrabold mt-2">₹{report.outstandingValue.toLocaleString()}</h3>
                <p className="text-xs text-white/80 mt-1 font-medium">{report.outstandingUsable.toLocaleString()} spendable coins in circulation</p>
              </div>
              <Wallet className="absolute right-4 bottom-4 w-20 h-20 text-white/10" />
            </div>

            {/* Total Issued */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Total Credited</p>
                <ArrowUpRight className="w-5 h-5 text-emerald-500" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                {report.credited.toLocaleString()} <span className="text-sm font-normal text-gray-400">coins</span>
              </h3>
              <p className="text-xs text-gray-500 mt-1">Spendable: {report.creditedSpendable.toLocaleString()} coins</p>
            </div>

            {/* Total Redeemed */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Total Redeemed</p>
                <ArrowDownRight className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                {report.redeemed.toLocaleString()} <span className="text-sm font-normal text-gray-400">coins</span>
              </h3>
              <p className="text-xs text-gray-500 mt-1">Spent across customer orders</p>
            </div>

            {/* Expired */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Lapsed / Expired</p>
                <Clock className="w-5 h-5 text-rose-500" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                {report.expired.toLocaleString()} <span className="text-sm font-normal text-gray-400">coins</span>
              </h3>
              <p className="text-xs text-gray-500 mt-1">Unspent after {settings.expiryDays} days</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4">Platform Liability Breakdown</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-600 dark:text-gray-400">Gross Coins Created (Refunds, Spins, Grants)</span>
                <span className="font-semibold text-gray-900 dark:text-white">{report.credited.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-600 dark:text-gray-400">Total Spendable Units Authorized</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{report.creditedSpendable.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-600 dark:text-gray-400">Orders Redeemed (Net of Cancellations)</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">{report.redeemed.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-600 dark:text-gray-400">Manual Administrative Adjustments</span>
                <span className="font-semibold text-gray-900 dark:text-white">{report.removedByAdmin.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-base py-3 font-bold bg-amber-50 dark:bg-amber-950/20 px-4 rounded-xl">
                <span className="text-amber-950 dark:text-amber-200">Current Net Obligation (Owed by Platform)</span>
                <span className="text-amber-700 dark:text-amber-400">₹{report.outstandingValue.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MANUAL ADJUSTMENT */}
      {activeTab === "adjust" && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 md:p-8 max-w-2xl mx-auto shadow-sm space-y-6">
          <div className="border-b border-gray-100 dark:border-gray-800 pb-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-orange-500" />
              Manual Coin Adjustment
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Credit promotional bonus coins or deduct coins with mandatory audit trail.
            </p>
          </div>

          <form onSubmit={handleAdjustCoins} className="space-y-5">
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                User ID (MongoDB ObjectId)
              </label>
              <Input
                placeholder="e.g. 660f1b2c4e..."
                value={adjustForm.userId}
                onChange={(e) => setAdjustForm({ ...adjustForm, userId: e.target.value })}
                required
                className="mt-1 font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Action Type
                </label>
                <div className="flex mt-1 border rounded-xl overflow-hidden p-1 bg-gray-50 dark:bg-gray-800">
                  <button
                    type="button"
                    onClick={() => setAdjustForm({ ...adjustForm, type: "credit" })}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      adjustForm.type === "credit"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Credit (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustForm({ ...adjustForm, type: "debit" })}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      adjustForm.type === "debit"
                        ? "bg-rose-500 text-white shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Debit (-)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Coin Amount
                </label>
                <Input
                  type="number"
                  min="1"
                  placeholder="e.g. 100"
                  value={adjustForm.amount}
                  onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
                  required
                  className="mt-1 font-semibold"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Audit Reason (Mandatory)
              </label>
              <textarea
                placeholder="e.g. Compensation for late delivery or order missing item dispute..."
                rows={3}
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                required
                className="mt-1 w-full p-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <Button
              type="submit"
              disabled={adjusting}
              className={`w-full py-3 font-semibold rounded-xl text-white shadow-md ${
                adjustForm.type === "credit"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-rose-600 hover:bg-rose-700"
              }`}
            >
              {adjusting
                ? "Processing Adjustment..."
                : adjustForm.type === "credit"
                ? "Credit Coins to Customer"
                : "Debit Coins from Customer"}
            </Button>
          </form>
        </div>
      )}

      {/* TAB 4: USER LEDGER SEARCH */}
      {activeTab === "ledger" && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Customer Coin Ledger Inspection</h2>
            <p className="text-xs text-gray-500 mt-1">Search any customer by their ID to view their full transaction ledger.</p>
          </div>

          <form onSubmit={handleSearchUserLedger} className="flex gap-3 max-w-xl">
            <Input
              placeholder="Enter User ID (ObjectId)..."
              value={searchUserId}
              onChange={(e) => setSearchUserId(e.target.value)}
              className="font-mono text-sm"
            />
            <Button
              type="submit"
              disabled={searchingLedger}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 font-semibold"
            >
              <Search className="w-4 h-4 mr-2" />
              {searchingLedger ? "Searching..." : "Inspect"}
            </Button>
          </form>

          {userLedger && (
            <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 font-semibold border-b">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Spendable</th>
                    <th className="p-3">Source / Ref</th>
                    <th className="p-3">Audit Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {userLedger.entries?.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-gray-400">
                        No coin transactions recorded for this user.
                      </td>
                    </tr>
                  ) : (
                    userLedger.entries.map((entry) => (
                      <tr key={entry._id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                        <td className="p-3 text-gray-600 dark:text-gray-400">
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded font-bold uppercase ${
                              entry.type === "credit"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : entry.type === "debit"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                                : entry.type === "expire"
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                            }`}
                          >
                            {entry.type}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-gray-900 dark:text-white">
                          {["debit", "expire", "adjust"].includes(entry.type) ? `-${Math.abs(entry.amount)}` : `+${entry.amount}`}
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400">
                          {entry.spendable != null ? entry.spendable : "—"}
                        </td>
                        <td className="p-3 font-mono text-gray-500">
                          {entry.source || entry.refId || "—"}
                        </td>
                        <td className="p-3 text-gray-600 dark:text-gray-400">
                          {entry.note || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
