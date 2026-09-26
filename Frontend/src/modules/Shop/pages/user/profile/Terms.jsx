import CMSPage from "@shop/components/user/CMSPage"
import { API_ENDPOINTS } from "@shop/api/config"

export default function Terms() {
  return (
    <CMSPage 
      endpoint={API_ENDPOINTS.ADMIN.TERMS_PUBLIC} 
      title="Terms of Service" 
      module="USER"
    />
  )
}
