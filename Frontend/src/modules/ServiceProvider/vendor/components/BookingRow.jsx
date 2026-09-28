import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { StatusBadge, fmtDate, inr } from "../../components/partner/ui"
import { BASE } from "../vendorApi"

// A booking in a list, as GET /vendors/bookings projects it.
export default function BookingRow({ booking }) {
  const service = booking.serviceName || booking.serviceId?.title || "Service"
  return (
    <Link
      to={`${BASE}/bookings/${booking._id}`}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm active:bg-slate-50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{service}</p>
          <StatusBadge status={booking.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {booking.bookingNumber} · {booking.userId?.name || "Customer"} · {fmtDate(booking.scheduledDate)}
          {booking.scheduledTime ? ` ${booking.scheduledTime}` : ""}
        </p>
        {booking.workerId?.name && <p className="mt-0.5 text-xs text-indigo-700">Worker: {booking.workerId.name}</p>}
      </div>
      <div className="text-right">
        <p className="font-bold">{inr(booking.finalAmount)}</p>
        <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
      </div>
    </Link>
  )
}
