import mongoose from 'mongoose';
import { buildAdminSchema } from '../../../../core/admin/admin.model.js';

/*
 * Taxi's view of the shared `admins` collection. The fields are the platform's
 * one admin schema (core/admin/admin.model.js); only taxi's habits differ:
 * it hashes passwords itself before writing, asks for them with '+password',
 * and makes superadmins by default.
 */
const adminSchema = buildAdminSchema({
  hashOnSave: false,
  hidePassword: true,
  defaults: { role: 'superadmin', admin_type: 'superadmin', servicesAccess: undefined },
});

export const Admin = mongoose.models.TaxiAdmin || mongoose.model('TaxiAdmin', adminSchema);
