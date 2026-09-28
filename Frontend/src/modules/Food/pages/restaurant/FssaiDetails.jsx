import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react"
import { restaurantAPI } from "@food/api"

const DAY_MS = 24 * 60 * 60 * 1000

const urlOf = (image) => {
  if (!image) return ""
  return String(typeof image === "string" ? image : image.url || "").trim()
}

/** How the licence stands today, from its expiry date. */
const expiryState = (expiry) => {
  if (!expiry) return null
  const at = new Date(expiry)
  if (Number.isNaN(at.getTime())) return null
  const daysLeft = Math.ceil((at.getTime() - Date.now()) / DAY_MS)
  if (daysLeft < 0) return { tone: "expired", text: "This licence has expired. Upload the renewed licence to keep selling." }
  if (daysLeft <= 30) return { tone: "soon", text: `This licence expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Renew it and upload the new one.` }
  return { tone: "ok", text: "Your licence is valid." }
}

export default function FssaiDetails() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [fssai, setFssai] = useState({ number: "", expiry: null, document: "", status: "" })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant || {}
        if (cancelled) return
        setFssai({
          number: String(data.fssaiNumber || "").trim(),
          expiry: data.fssaiExpiry || null,
          document: urlOf(data.fssaiImage),
          status: data.status || "",
        })
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || "Could not load your licence details")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const state = expiryState(fssai.expiry)
  const hasLicence = Boolean(fssai.number || fssai.document)
  const banner = !hasLicence
    ? { tone: "soon", text: "No FSSAI licence on file yet. Add it so customers and the platform can verify your kitchen." }
    : state

  const bannerCls = banner?.tone === "expired"
    ? "bg-red-50 text-red-800 border-red-200"
    : banner?.tone === "soon"
      ? "bg-amber-50 text-amber-900 border-amber-200"
      : "bg-emerald-50 text-emerald-900 border-emerald-200"

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
        <button
          onClick={goBack}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900">FSSAI Details</h1>
          <p className="text-xs text-gray-500">Your food safety licence on file</p>
        </div>
      </div>

      <div className="flex-1 px-4 pt-4 pb-28 space-y-4 max-w-2xl w-full mx-auto">
        {loading ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-600">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Loading licence...</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : (
          <>
            {banner && (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${bannerCls}`}>{banner.text}</div>
            )}
            {fssai.status === "pending" && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-700">
                Your latest profile changes are awaiting admin verification.
              </div>
            )}

            <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">FSSAI registration number</p>
                <p className="text-sm font-semibold text-gray-900 font-mono">{fssai.number || "Not added"}</p>
              </div>

              <div className="border-t border-dashed border-gray-200" />

              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Document</p>
                  <p className="text-sm font-semibold text-gray-900">{fssai.document ? "Licence uploaded" : "No document uploaded"}</p>
                </div>
                {fssai.document && (
                  <a
                    href={fssai.document}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                    aria-label="Open licence document"
                  >
                    <ExternalLink className="w-4 h-4 text-gray-800" />
                  </a>
                )}
              </div>

              <div className="border-t border-dashed border-gray-200" />

              <div>
                <p className="text-xs text-gray-500 mb-1">Valid up to</p>
                <p className="text-sm font-semibold text-gray-900">
                  {fssai.expiry
                    ? new Date(fssai.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                    : "Not added"}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="px-4 pb-6 pt-3 border-t border-gray-200 bg-white">
        <button
          type="button"
          className="w-full py-3 rounded-full bg-black text-white text-sm font-medium disabled:opacity-50"
          disabled={loading}
          onClick={() => navigate("/restaurant/fssai/update")}
        >
          {hasLicence ? "Update FSSAI licence" : "Add FSSAI licence"}
        </button>
      </div>
    </div>
  )
}
