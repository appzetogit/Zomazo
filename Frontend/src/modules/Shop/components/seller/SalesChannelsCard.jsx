import React, { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { sellerAPI } from "@store/api"
import { CHANNELS, CHANNEL_INFO, CHANNEL_STATUS_LABEL, channelStatus } from "./channels"

const STATUS_CLS = {
  none: "bg-gray-100 text-gray-700",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
}

/** "Sales channels" card: status per channel + Apply / Re-apply (POST /seller/channels/:channel/apply). */
export default function SalesChannelsCard({ className = "" }) {
  const [seller, setSeller] = useState(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(null)
  const [errors, setErrors] = useState({})

  const load = useCallback(async () => {
    try {
      const res = await sellerAPI.getCurrentSeller()
      setSeller(res?.data?.data?.seller || res?.data?.seller || null)
    } catch {
      // leave as is
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const apply = async (channel) => {
    setApplying(channel)
    setErrors((p) => ({ ...p, [channel]: null }))
    try {
      await sellerAPI.applyForChannel(channel)
      toast.success(`Applied for ${CHANNEL_INFO[channel].label}. We'll review it shortly.`)
      await load()
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Could not apply"
      setErrors((p) => ({ ...p, [channel]: msg }))
      toast.error(msg)
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 space-y-3 ${className}`}>
      <div>
        <h3 className="text-base font-bold text-gray-900">Sales channels</h3>
        <p className="text-xs text-gray-500">Choose where customers can buy from you. Each channel is reviewed separately.</p>
      </div>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      ) : (
        CHANNELS.map((c) => {
          const status = channelStatus(seller, c)
          const reason = seller?.channels?.[c]?.rejectionReason
          const canApply = status === "none" || status === "rejected"
          return (
            <div key={c} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{CHANNEL_INFO[c].label}</p>
                  <p className="text-xs text-gray-500">{CHANNEL_INFO[c].blurb}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[status] || STATUS_CLS.none}`}>
                  {CHANNEL_STATUS_LABEL[status] || status}
                </span>
              </div>
              {status === "rejected" && reason && (
                <p className="mt-2 text-xs text-rose-700">Reason: {reason}</p>
              )}
              {errors[c] && <p className="mt-2 text-xs text-rose-700">{errors[c]}</p>}
              {canApply && (
                <button
                  type="button"
                  onClick={() => apply(c)}
                  disabled={applying !== null}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black text-white text-xs font-semibold disabled:opacity-50"
                >
                  {applying === c && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {status === "rejected" ? "Re-apply" : "Apply"}
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
