import SellerCMSPage from "./SellerCMSPage"
import { API_ENDPOINTS } from "@store/api/config"

export default function SellerHelpSupport() {
  return (
    <SellerCMSPage 
      endpoint={API_ENDPOINTS.ADMIN.SUPPORT_PUBLIC} 
      title="Help & Support" 
      module="SELLER"
    />
  )
}
