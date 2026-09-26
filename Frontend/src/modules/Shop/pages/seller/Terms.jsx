import SellerCMSPage from "./SellerCMSPage"
import { API_ENDPOINTS } from "@shop/api/config"

export default function SellerTerms() {
  return (
    <SellerCMSPage 
      endpoint={API_ENDPOINTS.ADMIN.TERMS_PUBLIC} 
      title="Terms & Conditions" 
      module="SELLER"
    />
  )
}
