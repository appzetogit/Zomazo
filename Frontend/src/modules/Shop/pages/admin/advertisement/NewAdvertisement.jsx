import AdminNewAd from "@/shared/spotlight/AdminNewAd"

// An admin-made ad for a seller, or a platform-wide banner (Backend core/spotlight).
export default function NewAdvertisement() {
  return <AdminNewAd service="shop" businessLabel="Seller" />
}
