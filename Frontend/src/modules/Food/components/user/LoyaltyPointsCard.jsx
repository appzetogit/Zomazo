import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Gift, Loader2 } from "lucide-react"
import { loyaltyAPI } from "@food/api"

/**
 * The customer's loyalty points, earned on orders in every service, with a
 * button turning them into wallet money (core/loyalty). Hidden while the
 * programme is off and the customer has no points.
 */
export default function LoyaltyPointsCard({ onConverted }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    loyaltyAPI.get().then((res) => setData(res?.data?.data || null)).catch(() => setData(null))
  }, [])

  useEffect(() => { load() }, [load])

  if (!data || (!data.enabled && !data.balance)) return null
  const canConvert = data.enabled && data.balance >= data.minConvertPoints && data.worth > 0

  const convert = async () => {
    setBusy(true)
    try {
      const res = await loyaltyAPI.convert(data.balance)
      const out = res?.data?.data || {}
      toast.success(`${out.converted} points added to your wallet as ₹${out.amount}`)
      load()
      onConverted?.()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not convert points")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-center gap-3 flex-1">
        <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
          <Gift className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-amber-800 dark:text-amber-300">Loyalty points</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {data.balance.toLocaleString("en-IN")} <span className="text-sm font-normal text-gray-600 dark:text-gray-400">worth ₹{data.worth}</span>
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {data.pointsPerRupee} points = ₹1 · convert {data.minConvertPoints} or more
          </p>
        </div>
      </div>
      <button
        onClick={convert}
        disabled={!canConvert || busy}
        className="h-10 px-5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Convert to wallet
      </button>
    </div>
  )
}
