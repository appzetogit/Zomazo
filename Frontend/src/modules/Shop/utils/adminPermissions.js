/**
 * Super-admin-only areas: Feature Settings and the "Super Powers" pages
 * (Power Scanning). The backend requires system_settings for these, which only
 * a super admin holds, so the UI gates on the same thing: the account type,
 * never a particular email.
 */
import { isPlatformAdmin } from "@shop/utils/platformAdmin"

const isSuperAdmin = (adminUser) =>
  isPlatformAdmin(adminUser) || String(adminUser?.adminType || "") === "super_admin"

export function canAccessFeatureSettings(adminUser) {
  return isSuperAdmin(adminUser)
}

export function canAccessSuperPowers(adminUser) {
  return isSuperAdmin(adminUser)
}
