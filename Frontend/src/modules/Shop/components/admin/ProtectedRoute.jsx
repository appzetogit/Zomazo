import { useEffect, useState } from "react"
import { Navigate, useLocation } from "@shop/router"
import { adminAPI } from "@shop/api"
import {
  ensureValidAccessToken,
  getCurrentUser,
  isModuleAuthenticated,
} from "@shop/utils/auth"
import { canAccessAdminPath, findFirstAllowedAdminPath } from "@shop/utils/adminRbac"
import { getAdminPanelFromPath } from "./useAdminPanel"

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const [status, setStatus] = useState(() =>
    isModuleAuthenticated("admin") ? "checking" : "deny"
  )

  useEffect(() => {
    let isMounted = true

    const syncAdminProfile = async () => {
      if (!isModuleAuthenticated("admin")) {
        if (isMounted) setStatus("deny")
        return
      }

      if (isMounted) setStatus("checking")

      const accessToken = await ensureValidAccessToken("admin")
      if (!accessToken) {
        if (isMounted) setStatus("deny")
        return
      }

      // The session is the PLATFORM admin's (admin_accessToken / admin_user,
      // written by the platform's /admin/login). This guard only checks it is
      // still good; it never rewrites or clears it. The standalone guard stored
      // its own profile over admin_user and, on any 401/403, deleted the token --
      // which signed the admin out of the whole platform, and did so for every
      // food-only admin who merely opened /admin/shop.
      try {
        await adminAPI.getCurrentAdmin()
        if (isMounted) setStatus("ok")
      } catch (error) {
        if (error?.response?.status === 401) {
          if (isMounted) setStatus("deny")
          return
        }
        // Network/server blips keep the session.
        if (isMounted) setStatus("ok")
      }
    }

    syncAdminProfile()

    return () => {
      isMounted = false
    }
  }, [location.pathname])

  if (status === "checking") {
    return <div className="min-h-screen bg-neutral-100" />
  }

  if (status === "deny") {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  const adminUser = getCurrentUser("admin")
  if (!canAccessAdminPath(location.pathname, "view")) {
    return <Navigate to={findFirstAllowedAdminPath(adminUser, getAdminPanelFromPath(location.pathname))} replace />
  }

  return children
}
