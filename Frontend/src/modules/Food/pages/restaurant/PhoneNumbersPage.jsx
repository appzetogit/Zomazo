import { useEffect, useState } from "react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, Phone, Lock, Loader2 } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

/*
 * The outlet's phone numbers, as the backend stores them.
 *
 * Two numbers exist: the owner's sign-in number (ownerPhone), which is the
 * account's identity and is changed through support, and the outlet contact
 * number (primaryContactNumber) that customers, riders and support call. The
 * old screen showed three hard-coded numbers and "verified" any 6-digit OTP
 * without saving anything.
 */
const digitsOf = (value) => String(value || "").replace(/\D/g, "")
const display = (value) => {
  const d = digitsOf(value)
  if (!d) return ""
  const last10 = d.slice(-10)
  return d.length > 10 ? `+${d.slice(0, d.length - 10)} ${last10}` : `+91 ${last10}`
}

export default function PhoneNumbersPage() {
  const goBack = useRestaurantBackNavigation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ownerPhone, setOwnerPhone] = useState("")
  const [contact, setContact] = useState("")
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant || {}
        if (cancelled) return
        setOwnerPhone(data.ownerPhone || "")
        setContact(data.primaryContactNumber || "")
      } catch (err) {
        if (!cancelled) toast.error(err?.response?.data?.message || "Could not load phone numbers")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const startEdit = () => {
    setDraft(digitsOf(contact).slice(-10))
    setError("")
    setEditing(true)
  }

  const save = async () => {
    const d = digitsOf(draft)
    if (d.length !== 10 || !/^[6-9]/.test(d)) {
      setError("Enter a valid 10-digit mobile number")
      return
    }
    setSaving(true)
    try {
      const res = await restaurantAPI.updateProfile({ primaryContactNumber: d })
      const saved = res?.data?.data?.restaurant?.primaryContactNumber ?? d
      setContact(saved)
      setEditing(false)
      toast.success("Contact number saved and sent for verification")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save the number")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Phone numbers</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Numbers customers, riders and support use to reach your outlet</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {loading ? (
          <div className="py-16 flex justify-center text-gray-600"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0"><Lock className="w-4 h-4 text-gray-700" /></div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Sign-in number</p>
                    <p className="text-xs text-gray-500">The owner's number used to log in. Contact support to change it.</p>
                    <p className="text-sm font-semibold text-gray-900 mt-2 font-mono">{display(ownerPhone) || "Not set"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0"><Phone className="w-4 h-4 text-gray-700" /></div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">Outlet contact number</p>
                  <p className="text-xs text-gray-500">Shown to riders and support for order calls. Changes are re-verified by the admin.</p>
                  {editing ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <span className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-semibold">+91</span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={draft}
                          onChange={(e) => { setDraft(e.target.value.replace(/\D/g, "")); setError("") }}
                          className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 ${error ? "border-red-400" : "border-gray-200"}`}
                          placeholder="10-digit mobile number"
                          autoFocus
                        />
                      </div>
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
                        <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50 inline-flex items-center gap-1.5">
                          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900 font-mono">{display(contact) || "Not set"}</p>
                      <button type="button" onClick={startEdit} className="text-xs font-bold text-gray-900 underline underline-offset-2">
                        {contact ? "Change" : "Add"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
