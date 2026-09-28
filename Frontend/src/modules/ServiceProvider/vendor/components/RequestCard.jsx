import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Clock, MapPin } from "lucide-react"
import { toast } from "sonner"
import { Button, Card, addressLine, errorMessage, fmtDate, inr } from "../../components/partner/ui"
import { BASE, vendorApi } from "../vendorApi"

const secondsLeft = (expiresAt) => (expiresAt ? Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)) : null)

/*
 * One offered job with its accept window. Accepting is first-come: the backend
 * answers 400 when another vendor got there first, and the socket's booking_taken
 * removes the card from everyone else's list.
 */
export default function RequestCard({ request, onDone }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)
  const [left, setLeft] = useState(() => secondsLeft(request.expiresAt))

  useEffect(() => {
    if (!request.expiresAt) return undefined
    const t = setInterval(() => setLeft(secondsLeft(request.expiresAt)), 1000)
    return () => clearInterval(t)
  }, [request.expiresAt])

  const id = request.bookingId

  const act = async (kind) => {
    setBusy(kind)
    try {
      if (kind === "accept") {
        await vendorApi.accept(id)
        toast.success("Booking accepted")
        onDone?.(id)
        navigate(`${BASE}/bookings/${id}`)
      } else {
        await vendorApi.reject(id, "Not available")
        toast("Request declined")
        onDone?.(id)
      }
    } catch (error) {
      toast.error(errorMessage(error, "That did not go through"))
      onDone?.(id)
    } finally {
      setBusy(null)
    }
  }

  const expired = left === 0

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{request.serviceName || "Service booking"}</p>
          <p className="text-xs text-slate-500">
            {[request.serviceCategory, request.brandName].filter(Boolean).join(" · ") || request.bookingNumber}
          </p>
        </div>
        <p className="text-lg font-bold text-emerald-700">{inr(request.price)}</p>
      </div>
      <div className="mt-3 space-y-1 text-sm text-slate-600">
        <p className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          {fmtDate(request.scheduledDate)} {request.scheduledTime && `· ${request.scheduledTime}`}
        </p>
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2">
            {addressLine(request.address) || "Location shared on accept"}
            {request.distance != null && ` · ${Number(request.distance).toFixed(1)} km`}
          </span>
        </p>
      </div>
      {left != null && (
        <p className={`mt-2 text-xs font-semibold ${expired ? "text-rose-600" : "text-amber-700"}`}>
          {expired ? "Offer window closed" : `Respond within ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={busy === "reject"} disabled={Boolean(busy)} onClick={() => act("reject")}>
          Decline
        </Button>
        <Button loading={busy === "accept"} disabled={Boolean(busy) || expired} onClick={() => act("accept")}>
          Accept
        </Button>
      </div>
    </Card>
  )
}
