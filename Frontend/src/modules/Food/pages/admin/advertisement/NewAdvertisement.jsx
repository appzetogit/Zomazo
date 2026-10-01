import AdminNewAd from "@/shared/spotlight/AdminNewAd"

// An admin-made ad for a restaurant, or a platform-wide banner (Backend core/spotlight).
export default function NewAdvertisement() {
  return <AdminNewAd service="food" businessLabel="Restaurant" />
}
