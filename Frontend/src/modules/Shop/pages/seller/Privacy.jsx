import SellerCMSPage from "./SellerCMSPage"
import { API_ENDPOINTS } from "@store/api/config"

export default function SellerPrivacy() {
  return (
    <SellerCMSPage 
      endpoint={API_ENDPOINTS.ADMIN.PRIVACY_PUBLIC} 
      title="Privacy Policy" 
      module="SELLER"
    />
  )
}
