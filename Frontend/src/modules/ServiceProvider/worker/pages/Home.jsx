import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Clock, MapPin } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, Empty, Shell, Spinner, Stat, addressLine, errorMessage, fmtDate, inr } from "../../components/partner/ui"
import JobRow, { ACTIVE } from "../components/JobRow"
import { workerNav } from "../nav"
import useWorkerLive from "../useWorkerLive"
import { BASE, currentCoords, storedWorker, workerApi } from "../workerApi"

function RequestCard({ job, onDone }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)
  const respond = async (status) => {
    setBusy(status)
    try {
      await workerApi.respond(job._id, status)
      onDone(job._id)
      if (status === "ACCEPTED") {
        toast.success("Job accepted")
        navigate(`${BASE}/jobs/${job._id}`)
      }
    } catch (error) {
      toast.error(errorMessage(error, "That did not go through"))
      onDone(job._id)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{job.serviceName || job.serviceId?.title || "Service"}</p>
        <p className="text-lg font-bold text-emerald-700">{inr(job.finalAmount)}</p>
      </div>
      <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
        <Clock className="h-4 w-4" /> {fmtDate(job.scheduledDate)} {job.scheduledTime || ""}
      </p>
      <p className="mt-1 flex items-start gap-2 text-sm text-slate-600">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="line-clamp-2">
          {addressLine(job.address) || "Location on accept"}
          {job.distance != null && ` · ${Number(job.distance).toFixed(1)} km`}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={busy === "REJECTED"} disabled={Boolean(busy)} onClick={() => respond("REJECTED")}>
          Decline
        </Button>
        <Button loading={busy === "ACCEPTED"} disabled={Boolean(busy)} onClick={() => respond("ACCEPTED")}>
          Accept
        </Button>
      </div>
    </Card>
  )
}

export default function Home() {
  const worker = storedWorker()
  const [online, setOnline] = useState(null)
  const [toggling, setToggling] = useState(false)
  const [stats, setStats] = useState(null)
  const [jobs, setJobs] = useState(null)

  const load = useCallback(async () => {
    const [s, j] = await Promise.allSettled([workerApi.stats(), workerApi.jobs({ limit: 50 })])
    if (s.status === "fulfilled") setStats(s.value?.data || {})
    if (j.status === "fulfilled") setJobs((j.value?.data || []).filter((b) => ACTIVE.includes(b.status)))
    else setJobs((prev) => prev || [])
  }, [])

  const { requests, drop, connected } = useWorkerLive(load)

  useEffect(() => {
    load()
    workerApi
      .profile()
      .then((res) => setOnline(Boolean(res?.worker?.isOnline)))
      .catch(() => setOnline(false))
  }, [load])

  // While on duty, keep the server's idea of where the worker is fresh enough for
  // the nearest-worker search. Once every two minutes is plenty for that.
  useEffect(() => {
    if (!online) return undefined
    const push = async () => {
      const c = await currentCoords()
      if (c) workerApi.updateLocation(c.lat, c.lng).catch(() => {})
    }
    push()
    const t = setInterval(push, 120000)
    return () => clearInterval(t)
  }, [online])

  const toggle = async () => {
    setToggling(true)
    try {
      const next = !online
      const coords = next ? await currentCoords() : null
      const res = await workerApi.setOnline(next, coords)
      setOnline(Boolean(res?.data?.isOnline ?? next))
      toast.success(res?.message || (next ? "You are online" : "You are offline"))
    } catch (error) {
      toast.error(errorMessage(error, "Could not change your status"))
    } finally {
      setToggling(false)
    }
  }

  // Jobs a vendor assigned and still waiting on this worker's yes/no sort first.
  const sorted = (jobs || []).slice().sort((a, b) => (b.workerResponse === "PENDING") - (a.workerResponse === "PENDING"))

  return (
    <Shell
      title={`Hi${worker?.name ? `, ${worker.name.split(" ")[0]}` : ""}`}
      subtitle={connected ? "Live updates on" : "Checking for jobs every 20 seconds"}
      nav={workerNav(requests.length)}
    >
      <Card className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{online ? "You are on duty" : "You are off duty"}</p>
          <p className="text-xs text-slate-500">{online ? "New jobs will ring here." : "Go online to receive jobs."}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(online)}
          disabled={online === null || toggling}
          onClick={toggle}
          className={`relative h-8 w-14 rounded-full transition disabled:opacity-60 ${online ? "bg-emerald-600" : "bg-slate-300"}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${online ? "left-7" : "left-1"}`} />
        </button>
      </Card>

      {requests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">New requests</h2>
          {requests.map((r) => (
            <RequestCard key={r._id} job={r} onDone={drop} />
          ))}
        </section>
      )}

      {stats && (
        <section className="grid grid-cols-2 gap-3">
          <Stat label="Earnings" value={inr(stats.totalEarnings)} tone="text-emerald-700" />
          <Stat label="Rating" value={stats.rating ? `${Number(stats.rating).toFixed(1)} ★` : "New"} />
          <Stat label="Active jobs" value={stats.activeJobs ?? 0} />
          <Stat label="Completed" value={stats.completedJobs ?? 0} />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Your jobs</h2>
        {!jobs ? (
          <Spinner />
        ) : sorted.length ? (
          sorted.map((j) => <JobRow key={j._id} job={j} />)
        ) : (
          <Empty title="No active jobs" hint={online ? "Stay online; jobs ring here." : undefined} />
        )}
      </section>
    </Shell>
  )
}
