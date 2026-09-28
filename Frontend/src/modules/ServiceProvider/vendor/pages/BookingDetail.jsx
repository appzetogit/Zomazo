import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MapPin, Phone, User } from "lucide-react"
import { toast } from "sonner"
import BillEditor, { BillSummary } from "../../components/partner/BillEditor"
import {
  Button,
  Card,
  Empty,
  Field,
  Shell,
  Spinner,
  StatusBadge,
  addressLine,
  errorMessage,
  fmtDateTime,
  inputClass,
  inr,
} from "../../components/partner/ui"
import useVendorLive from "../useVendorLive"
import { BASE, vendorApi } from "../vendorApi"

/*
 * One booking from offer to payment, with the step the backend will accept next.
 *
 * Two ways a job gets done (vendorBookingController):
 *   - a worker: assign-worker, then the worker drives it from their app and the
 *     vendor watches, reviews the bill and pays the worker afterwards;
 *   - the vendor themselves ("self"): self/start -> self/reached -> visit OTP from
 *     the customer -> self/complete with the bill -> payment OTP -> completed.
 */
const OPEN = ["requested", "searching"]
const READY = ["confirmed", "accepted", "assigned", "awaiting_payment"]

function OtpAction({ label, hint, onSubmit }) {
  const [otp, setOtp] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!/^\d{4,6}$/.test(otp)) return toast.error("Enter the code the customer shared")
    setBusy(true)
    try {
      await onSubmit(otp)
      setOtp("")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <Field label={label} hint={hint}>
        <input
          className={`${inputClass} text-center text-xl tracking-[0.4em]`}
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <Button className="w-full" loading={busy} onClick={submit}>
        Verify
      </Button>
    </div>
  )
}

export default function BookingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [booking, setBooking] = useState(null)
  const [bill, setBill] = useState(null)
  const [missing, setMissing] = useState(false)
  const [workers, setWorkers] = useState([])
  const [workerId, setWorkerId] = useState("")
  const [busy, setBusy] = useState(null)
  const [notes, setNotes] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await vendorApi.booking(id)
      setBooking(res?.data || null)
      if (res?.data?.vendorId) {
        vendorApi.bill(id).then((b) => setBill(b?.bill || null)).catch(() => {})
      }
    } catch (error) {
      if (error?.response?.status === 404) setMissing(true)
      else toast.error(errorMessage(error, "Could not load the booking"))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Realtime status (the worker's steps, the customer's payment) plus polling.
  useVendorLive(load)

  useEffect(() => {
    if (booking && READY.includes(booking.status) && !workers.length) {
      vendorApi
        .workers({ limit: 100 })
        .then((res) => setWorkers(res?.data || []))
        .catch(() => {})
    }
  }, [booking, workers.length])

  const loadCatalog = useCallback(async () => {
    const [s, p] = await Promise.all([vendorApi.catalogServices(), vendorApi.catalogParts()])
    return { services: s?.services, parts: p?.parts }
  }, [])

  const run = async (key, fn, success) => {
    setBusy(key)
    try {
      const res = await fn()
      if (success) toast.success(res?.message || success)
      await load()
      return res
    } catch (error) {
      toast.error(errorMessage(error, "That did not go through"))
      throw error
    } finally {
      setBusy(null)
    }
  }

  if (missing) {
    return (
      <Shell title="Booking" back={`${BASE}/bookings`}>
        <Empty title="Booking not found" hint="It may have been taken by another vendor or expired." />
      </Shell>
    )
  }
  if (!booking) {
    return (
      <Shell title="Booking" back={`${BASE}/bookings`}>
        <Spinner />
      </Shell>
    )
  }

  const status = booking.status
  const worker = booking.workerId
  const selfJob = !worker
  const customer = booking.userId || {}
  const ownJob = Boolean(booking.vendorId)
  const quiet = (fn) => () => fn().catch(() => {})

  return (
    <Shell title={booking.serviceName || booking.serviceId?.title || "Booking"} subtitle={booking.bookingNumber} back={`${BASE}/bookings`}>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <StatusBadge status={status} />
          <p className="text-xl font-bold">{inr(booking.finalAmount)}</p>
        </div>
        <div className="space-y-1.5 text-sm text-slate-600">
          <p>Scheduled: {fmtDateTime(booking.scheduledDate)} {booking.scheduledTime && `· ${booking.scheduledTime}`}</p>
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {addressLine(booking.address) || "-"}
          </p>
          {booking.paymentMethod && (
            <p>
              Payment: {booking.paymentMethod} · {booking.paymentStatus}
            </p>
          )}
        </div>
      </Card>

      {ownJob && (
        <Card className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
            <User className="h-5 w-5 text-slate-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{customer.name || "Customer"}</p>
            <p className="text-xs text-slate-500">Customer</p>
          </div>
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="rounded-full bg-emerald-50 p-2.5 text-emerald-700" aria-label="Call customer">
              <Phone className="h-5 w-5" />
            </a>
          )}
        </Card>
      )}

      {/* ---- offered, not yet taken ---- */}
      {OPEN.includes(status) && !ownJob && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            loading={busy === "reject"}
            onClick={quiet(() => run("reject", () => vendorApi.reject(id, "Not available"), "Declined").then(() => navigate(BASE)))}
          >
            Decline
          </Button>
          <Button loading={busy === "accept"} onClick={quiet(() => run("accept", () => vendorApi.accept(id), "Booking accepted"))}>
            Accept
          </Button>
        </div>
      )}

      {/* ---- who does the job ---- */}
      {ownJob && READY.includes(status) && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold">{worker ? `Assigned to ${worker.name}` : "Who will do this job?"}</p>
          <select className={inputClass} value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Choose a worker</option>
            {workers.map((w) => (
              <option key={w._id} value={w._id}>
                {w.name} {w.isOnline ? "(online)" : ""}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={!workerId}
              loading={busy === "assign"}
              onClick={quiet(() => run("assign", () => vendorApi.assignWorker(id, workerId), "Worker assigned"))}
            >
              {worker ? "Reassign" : "Assign"}
            </Button>
            {selfJob && (
              <Button loading={busy === "start"} onClick={quiet(() => run("start", () => vendorApi.selfStart(id), "Journey started"))}>
                I'll do it
              </Button>
            )}
          </div>
          {selfJob && <p className="text-xs text-slate-500">"I'll do it" starts your journey and sends the customer a visit code.</p>}
        </Card>
      )}

      {/* ---- doing it yourself ---- */}
      {ownJob && selfJob && status === "journey_started" && (
        <Card className="space-y-3">
          <Button
            variant="secondary"
            className="w-full"
            loading={busy === "reached"}
            onClick={quiet(() => run("reached", () => vendorApi.selfReached(id), "Customer notified"))}
          >
            I have reached
          </Button>
          <OtpAction
            label="Visit code"
            hint="Ask the customer for the code sent when you started."
            onSubmit={(otp) => run("visit", () => vendorApi.selfVerifyVisit(id, otp), "Visit verified")}
          />
        </Card>
      )}

      {ownJob && selfJob && ["visited", "in_progress"].includes(status) && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Finish and bill</h2>
          <BillEditor
            loadCatalog={loadCatalog}
            busy={busy === "complete"}
            submitLabel="Mark work done and send bill"
            onSubmit={(billDetails) => run("complete", () => vendorApi.selfComplete(id, billDetails), "Bill sent").catch(() => {})}
          />
        </section>
      )}

      {bill && <BillSummary bill={bill} />}

      {ownJob && selfJob && status === "work_done" && (
        <Card>
          <OtpAction
            label="Payment code"
            hint="Collect the bill total, then enter the payment code the customer received."
            onSubmit={(otp) => run("collect", () => vendorApi.selfCollect(id, otp), "Payment collected")}
          />
        </Card>
      )}

      {/* ---- a worker's job ---- */}
      {ownJob && worker && !READY.includes(status) && (
        <Card className="space-y-1 text-sm">
          <p className="font-semibold">Worker: {worker.name}</p>
          {worker.phone && (
            <a href={`tel:${worker.phone}`} className="text-emerald-700">
              {worker.phone}
            </a>
          )}
          <p className="text-slate-500">The worker updates this job from their app; it refreshes here live.</p>
        </Card>
      )}

      {ownJob && worker && status === "completed" && booking.workerPaymentStatus !== "PAID" && booking.workerPaymentStatus !== "SUCCESS" && !booking.isWorkerPaid && (
        <Button className="w-full" loading={busy === "pay"} onClick={quiet(() => run("pay", () => vendorApi.payWorker(id), "Worker marked as paid"))}>
          Mark worker as paid
        </Button>
      )}

      {ownJob && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Notes</p>
          {booking.vendorNotes && <p className="whitespace-pre-line text-sm text-slate-600">{booking.vendorNotes}</p>}
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note" />
          <Button
            variant="secondary"
            disabled={!notes.trim()}
            loading={busy === "notes"}
            onClick={quiet(() => run("notes", () => vendorApi.addNotes(id, notes.trim()), "Note saved").then(() => setNotes("")))}
          >
            Save note
          </Button>
        </Card>
      )}

      {booking.rating && (
        <Card className="text-sm">
          <p className="font-semibold">Customer rating: {booking.rating} ★</p>
          {booking.review && <p className="mt-1 text-slate-600">{booking.review}</p>}
        </Card>
      )}
    </Shell>
  )
}
