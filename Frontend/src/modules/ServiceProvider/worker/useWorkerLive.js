import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import usePartnerSocket from "../components/partner/usePartnerSocket"
import { playAlertRing } from "../utils/notificationSound"
import { workerApi } from "./workerApi"

const POLL_MS = 20000

/*
 * Open offers for this worker plus a nudge to refresh whatever the screen shows.
 *
 * Two kinds of work reach a worker (see the SP socket and booking controllers):
 * a vendor assigns them a job (new_job_assigned), or, when the platform runs the
 * direct worker model, a customer's request is offered to nearby workers
 * (new_booking_request, withdrawn by removeWorkerBooking). Polling
 * /workers/jobs/pending-requests covers anything the socket missed.
 */
export default function useWorkerLive(onChange) {
  const [requests, setRequests] = useState([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const refresh = useCallback(async () => {
    try {
      const res = await workerApi.requests()
      setRequests(res?.data || [])
    } catch {
      // keep the last list
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh()
        onChangeRef.current?.()
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const ring = () => {
    try {
      playAlertRing()
    } catch {
      // autoplay may be blocked until the page is touched
    }
  }

  const connected = usePartnerSocket("workerAccessToken", {
    new_job_assigned: (p) => {
      ring()
      toast.success(`New job assigned: ${p?.serviceName || "service"}`)
      onChangeRef.current?.()
    },
    new_booking_request: (p) => {
      ring()
      toast.success(`New request: ${p?.serviceName || "service"}`)
      refresh()
    },
    removeWorkerBooking: (p) => {
      const id = String(p?.bookingId || p?.id)
      setRequests((list) => list.filter((r) => String(r._id) !== id))
    },
    booking_updated: () => onChangeRef.current?.(),
    notification: (p) => {
      if (p?.title) toast(p.title, { description: p.message })
      onChangeRef.current?.()
    },
  })

  const drop = (id) => setRequests((list) => list.filter((r) => String(r._id) !== String(id)))

  return { requests, refresh, drop, connected }
}
