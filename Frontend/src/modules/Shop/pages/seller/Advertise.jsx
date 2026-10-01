import apiClient from "@shop/api/axios"
import PartnerAdvertise from "@/shared/spotlight/PartnerAdvertise"

// The seller's ad requests, on its own seller session.
export default function Advertise() {
  return <PartnerAdvertise client={apiClient} basePath="/seller/spotlight" contextModule="seller" />
}
