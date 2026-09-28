import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { StatusBadge, addressLine, fmtDate, inr } from "../../components/partner/ui"
import { BASE } from "../workerApi"

export const ACTIVE = ["assigned", "confirmed", "accepted", "journey_started", "visited", "in_progress", "work_done"]

export default function JobRow({ job }) {
  const awaiting = job.status === "assigned" && job.workerResponse === "PENDING"
  return (
    <Link
      to={`${BASE}/jobs/${job._id}`}
      className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm active:bg-slate-50 ${awaiting ? "border-amber-300" : "border-slate-200"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{job.serviceName || "Service"}</p>
          <StatusBadge status={job.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {fmtDate(job.scheduledDate)} {job.scheduledTime || ""} · {addressLine(job.address) || job.bookingNumber}
        </p>
        {awaiting && <p className="mt-0.5 text-xs font-semibold text-amber-700">Tap to accept</p>}
      </div>
      <div className="text-right">
        <p className="font-bold">{inr(job.finalAmount)}</p>
        <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
      </div>
    </Link>
  )
}
