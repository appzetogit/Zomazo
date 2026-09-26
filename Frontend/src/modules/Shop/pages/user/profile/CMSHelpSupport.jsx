import CMSPage from "@store/components/user/CMSPage"
import { API_ENDPOINTS } from "@store/api/config"

export default function CMSHelpSupport() {
  return (
    <CMSPage 
      endpoint={API_ENDPOINTS.ADMIN.SUPPORT_PUBLIC} 
      title="Help & Support" 
      module="USER"
    />
  )
}
