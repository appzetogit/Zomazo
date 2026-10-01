import AdminAdRequests from "@/shared/spotlight/AdminAdRequests"

// Ads sellers asked for, waiting for a decision (Backend core/spotlight).
export default function AdRequests() {
  return <AdminAdRequests service="shop" />
}
