import { Navigate } from "react-router-dom"
import { isModuleAuthenticated } from "@store/utils/auth"

/**
 * AuthRedirect Component
 * Redirects authenticated users away from auth pages to their module's home page
 */
export default function AuthRedirect({ children, module, redirectTo = null }) {
  const isAuthenticated = isModuleAuthenticated(module)

  const moduleHomePages = {
    user: "/food",
    seller: "/seller",
    delivery: "/food/delivery",
    admin: "/admin/quick",
  }

  if (isAuthenticated) {
    const homePath = redirectTo || moduleHomePages[module] || "/food"
    return <Navigate to={homePath} replace />
  }

  return <>{children}</>
}
