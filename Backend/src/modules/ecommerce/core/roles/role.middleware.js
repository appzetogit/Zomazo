// The platform's role gate, re-exported rather than kept as a copy.
//
// The copy this app shipped with did not let SUPER_ADMIN through an 'ADMIN'
// gate, so a platform super admin -- the only admin kind this module sees until
// it has its own -- got 403 on every e-commerce admin call.
export { requireRoles } from '../../../../core/roles/role.middleware.js';
