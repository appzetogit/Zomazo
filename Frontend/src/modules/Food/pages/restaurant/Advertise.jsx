import apiClient from "@food/api/axios"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import PartnerAdvertise from "@/shared/spotlight/PartnerAdvertise"

// The restaurant's ad requests, on its own restaurant session.
export default function Advertise() {
  const goBack = useRestaurantBackNavigation()
  return <PartnerAdvertise client={apiClient} basePath="/food/restaurant/spotlight" contextModule="restaurant" onBack={goBack} />
}
