import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MapPin, Navigation, Phone, User } from "lucide-react"
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
import useWorkerLive from "../useWorkerLive"
import { BASE, currentCoords, workerApi } from "../workerApi"

/*
 * One job, one next step, in the order workerBookingController enforces:
 *
 *   accept  ->  start journey (customer gets a visit code)  ->  reached
 *   ->  verify the visit code  ->  start work  ->  work done (customer gets a
 *   payment code)  ->  bill  ->  collect payment with that code  ->  completed
 */
function CodeEntry({ label, hint, action, onSubmit }) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!/^\d{4,6}$/.test(code)) return toast.error("Enter the code the customer shared")
    setBusy(true)
    try {
      await onSubmit(code)
      setCode("")
    } catch {
      // the caller already said what went wrong
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
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <Button className="w-full" loading={busy} onClick={submit}>
        {action}
      </Button>
    </div>
  )
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [bill, setBill] = useState(undefined)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(null)
  const [notes, setNotes] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await workerApi.job(id)
      const j = res?.data || null
      setJob(j)
      if (j && ["work_done", "completed"].includes(j.status)) {
        workerApi.bill(id).then((b) => setBill(b?.bill || null)).catch(() => setBill(null))
      }
    } catch (error) {
      const code = error?.response?.status
      if (code === 404 || code === 403) setMissing(true)
      else toast.error(errorMessage(error, "Could not load the job"))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useWorkerLive(load)

  const loadCatalog = useCallback(async () => {
    const [s, p] = await Promise.all([workerApi.catalogServices(), workerApi.catalogParts()])
    return { services: s?.services, parts: p?.parts }
  }, [])

  const run = async (key, fn, success) => {
    setBusy(key)
    try {
      const res = await fn()
      toast.success(res?.message || success)
      await load()
      return res
    } catch (error) {
      toast.error(errorMessage(error, "That did not go through"))
      throw error
    } finally {
      setBusy(null)
    }
  }
  const tap = (key, fn, success) => () => run(key, fn, success).catch(() => {})

  if (missing) {
    return (
      <Shell title="Job" back={`${BASE}/jobs`}>
        <Empty title="Job not available" hint="It may have gone to someone else or been cancelled." />
      </Shell>
    )
  }
  if (!job) {
    return (
      <Shell title="Job" back={`${BASE}/jobs`}>
        <Spinner />
      </Shell>
    )
  }

  const status = job.status
  const customer = job.userId || {}
  const vendor = job.vendorId && typeof job.vendorId === "object" ? job.vendorId : null
  const offered = ["requested", "searching"].includes(status) || (status === "assigned" && job.workerResponse === "PENDING")
  const canStart = !offered && ["assigned", "confirmed", "accepted"].includes(status)
  const address = addressLine(job.address)
  const lat = job.address?.lat
  const lng = job.address?.lng
  const mapsUrl =
    lat && lng
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
        : null

  return (
    <Shell title={job.serviceName || job.serviceId?.title || "Job"} subtitle={job.bookingNumber} back={`${BASE}/jobs`}>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <StatusBadge status={status} />
          <p className="text-xl font-bold">{inr(job.finalAmount)}</p>
        </div>
        <p className="text-sm text-slate-600">
          {fmtDateTime(job.scheduledDate)} {job.scheduledTime && `· ${job.scheduledTime}`}
        </p>
        <p className="flex items-start gap-2 text-sm text-slate-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {address || "-"}
        </p>
        {mapsUrl && !offered && (
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <Navigation className="h-4 w-4" /> Directions
          </a>
        )}
        {job.description && <p className="text-sm text-slate-600">{job.description}</p>}
      </Card>

      <Card className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
          <User className="h-5 w-5 text-slate-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{customer.name || "Customer"}</p>
          <p className="text-xs text-slate-500">{vendor ? `Job from ${vendor.businessName || vendor.name}` : "Customer"}</p>
        </div>
        {customer.phone && (
          <a href={`tel:${customer.phone}`} className="rounded-full bg-emerald-50 p-2.5 text-emerald-700" aria-label="Call customer">
            <Phone className="h-5 w-5" />
          </a>
        )}
      </Card>

      {offered && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            loading={busy === "reject"}
            onClick={() =>
              run("reject", () => workerApi.respond(id, "REJECTED"), "Job declined")
                .then(() => navigate(BASE))
                .catch(() => {})
            }
          >
            Decline
          </Button>
          <Button loading={busy === "accept"} onClick={tap("accept", () => workerApi.respond(id, "ACCEPTED"), "Job accepted")}>
            Accept
          </Button>
        </div>
      )}

      {canStart && (
        <Button className="w-full" loading={busy === "start"} onClick={tap("start", () => workerApi.start(id), "Journey started")}>
          Start journey
        </Button>
      )}

      {status === "journey_started" && (
        <Card className="space-y-3">
          <Button variant="secondary" className="w-full" loading={busy === "reached"} onClick={tap("reached", () => workerApi.reached(id), "Customer notified")}>
            I have reached
          </Button>
          <CodeEntry
            label="Visit code"
            hint="The customer received it when you started the journey."
            action="Verify and begin"
            onSubmit={async (otp) => {
              const coords = await currentCoords()
              await run("visit", () => workerApi.verifyVisit(id, otp, coords || undefined), "Visit verified")
            }}
          />
        </Card>
      )}

      {status === "visited" && (
        <Button className="w-full" loading={busy === "work"} onClick={tap("work", () => workerApi.setStatus(id, "in_progress"), "Work started")}>
          Start work
        </Button>
      )}

      {["visited", "in_progress"].includes(status) && (
        <Button
          variant={status === "visited" ? "secondary" : "primary"}
          className="w-full"
          loading={busy === "done"}
          onClick={tap("done", () => workerApi.complete(id), "Work marked done")}
        >
          Work done
        </Button>
      )}

      {status === "work_done" && bill === null && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Prepare the bill</h2>
          <p className="text-xs text-slate-500">The booked service is already on the bill. Add anything extra you did or fitted.</p>
          <BillEditor
            loadCatalog={loadCatalog}
            busy={busy === "bill"}
            submitLabel="Generate bill"
            onSubmit={(lines) => run("bill", () => workerApi.saveBill(id, lines), "Bill generated").catch(() => {})}
          />
        </section>
      )}

      {bill && <BillSummary bill={bill} />}

      {status === "work_done" && bill && (
        <Card>
          <CodeEntry
            label="Payment code"
            hint={`Collect ${inr(bill.grandTotal)} from the customer, then enter the payment code they received.`}
            action="Confirm payment collected"
            onSubmit={(otp) => run("collect", () => workerApi.collect(id, otp), "Payment collected")}
          />
        </Card>
      )}

      {status === "completed" && vendor && job.workerPaymentStatus === "PENDING" && !job.cashCollected && (
        <Button variant="secondary" className="w-full" loading={busy === "payout"} onClick={tap("payout", () => workerApi.requestPayout(id), "Payment request sent")}>
          Ask the vendor to pay me
        </Button>
      )}

      {!offered && !["completed", "cancelled", "rejected"].includes(status) && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold">Notes</p>
          {job.workerNotes && <p className="whitespace-pre-line text-sm text-slate-600">{job.workerNotes}</p>}
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for the vendor" />
          <Button
            variant="secondary"
            disabled={!notes.trim()}
            loading={busy === "notes"}
            onClick={() =>
              run("notes", () => workerApi.addNotes(id, notes.trim()), "Note saved")
                .then(() => setNotes(""))
                .catch(() => {})
            }
          >
            Save note
          </Button>
        </Card>
      )}
    </Shell>
  )
}
