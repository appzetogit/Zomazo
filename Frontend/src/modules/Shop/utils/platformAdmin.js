/**
 * Is this stored admin a platform admin (rather than one of the standalone
 * app's own ecom_admins)?
 *
 * Inside the platform the Shop panel is opened with the platform admin's session
 * (admin_user / admin_accessToken, written by the platform's /admin/login). That
 * object carries role / admin_type / adminLevel and a flat permissions array --
 * not the Shop's `adminType` + per-section permissions -- so the Shop's own RBAC
 * read every platform admin as a sub-admin with no sections.
 *
 * The server is what decides: /ecom/admin sits behind servicesAccess
 * 'ecommerce', and a platform admin it admits gets full Shop access (see the
 * module's adminPermission middleware). The panel mirrors that.
 */
export function isPlatformAdmin(adminUser) {
  if (!adminUser || typeof adminUser !== "object") return false;
  if (adminUser.adminType) return false; // the Shop's own admin shape
  return Boolean(adminUser.role || adminUser.admin_type || adminUser.adminLevel);
}
