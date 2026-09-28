import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import usePartnerSocket from "../components/partner/usePartnerSocket"
import { playAlertRing } from "../utils/notificationSound"
import { vendorApi } from "./vendorApi"

const POLL_MS = 20000

/*
 * The vendor's open requests: jobs offered to them that nobody has taken yet.
 *
 * The socket is the fast path (new_booking_request rings the moment the server
 * offers the job; booking_taken / removeVendorBooking withdraw it), and polling
 * GET /vendors/bookings/pending is the safety net for a dropped socket or a phone
 * that slept -- the backend added that endpoint for exactly this ("fetch missed
 * alerts on reconnect"). `onChange` lets a screen refresh its own data too.
 */
export default function useVendorLive(onChange) {
  const [requests, setRequests] = useState([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await vendorApi.pending()
      setRequests(res?.data || [])
    } catch {
      // keep the last list; the next poll tries again
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh()
        onChange?.()
      }
    }, POLL_MS)
    return () => clearInterval(timer)
    // onChange is a screen callback; polling should not restart when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const drop = (id) => setRequests((list) => list.filter((r) => String(r.bookingId) !== String(id)))

  const connected = usePartnerSocket("vendorAccessToken", {
    new_booking_request: (payload) => {
      try {
        playAlertRing()
      } catch {
        // sound is best effort (autoplay rules)
      }
      toast.success(`New request: ${payload?.serviceName || "service booking"}`)
      refresh()
      onChange?.()
    },
    booking_taken: (payload) => {
      drop(payload?.bookingId)
      onChange?.()
    },
    removeVendorBooking: (payload) => {
      drop(payload?.bookingId || payload?.id)
      onChange?.()
    },
    booking_updated: () => onChange?.(),
    notification: (payload) => {
      if (payload?.title) toast(payload.title, { description: payload.message })
      onChange?.()
    },
  })

  return { requests, loaded, refresh, drop, connected }
}
