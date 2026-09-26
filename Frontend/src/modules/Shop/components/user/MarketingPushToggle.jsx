import { useEffect, useState } from "react"
import { BellRing } from "lucide-react"
import { toast } from "sonner"
import { userAPI } from "@store/api"
import { Card, CardContent } from "@store/components/ui/card"

/** Customer setting: receive offers & promotions push notifications (default on). */
export default function MarketingPushToggle() {
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    userAPI
      .getNotificationPreferences()
      .then((res) => {
        if (alive) setEnabled(res?.data?.data?.marketingPush !== false)
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const toggle = async () => {
    const next = !enabled
    setEnabled(next)
    setSaving(true)
    try {
      await userAPI.updateNotificationPreferences({ marketingPush: next })
      toast.success(next ? "Offer notifications turned on" : "Offer notifications turned off")
    } catch (err) {
      setEnabled(!next)
      toast.error(err?.response?.data?.message || "Could not save your preference")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="bg-white dark:bg-[#1a1a1a] py-0 rounded-xl shadow-sm border-0 dark:border-gray-800">
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-gray-100 dark:bg-gray-800 rounded-full p-2">
            <BellRing className="h-5 w-5 text-gray-700 dark:text-gray-300" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-medium text-gray-900 dark:text-white">Offers & promotions</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Push notifications about deals. Order updates always arrive.</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Offers and promotions notifications"
          disabled={loading || saving}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-green-600" : "bg-gray-300 dark:bg-gray-700"}`}>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </CardContent>
    </Card>
  )
}
