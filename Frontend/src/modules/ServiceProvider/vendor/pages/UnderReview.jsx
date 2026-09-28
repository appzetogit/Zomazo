import { Link } from "react-router-dom"
import { Clock } from "lucide-react"
import { Card } from "../../components/partner/ui"
import { BASE } from "../vendorApi"

// Where a vendor waits while an admin checks their documents. The backend gives a
// pending account no token, so there is nothing to poll: they sign in again later.
export default function UnderReview() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16">
      <Card className="mx-auto max-w-md p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Your account is under review</h1>
        <p className="mt-2 text-sm text-slate-600">
          We are checking your documents. Once an admin approves your account you can sign in with the same number and
          start receiving bookings.
        </p>
        <Link
          to={`${BASE}/login`}
          className="mt-6 inline-flex min-h-[2.75rem] items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white"
        >
          Back to sign in
        </Link>
      </Card>
    </div>
  )
}
