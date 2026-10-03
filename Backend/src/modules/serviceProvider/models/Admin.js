const mongoose = require('mongoose');
const { buildAdminSchema } = require('../../../core/admin/admin.model.js');

/*
 * Services' view of the shared `admins` collection. The fields are the
 * platform's one admin schema (core/admin/admin.model.js), so an account Master
 * or taxi made loads and saves here too. Services hashes on save like Food, and
 * asks for the password with '+password'.
 *
 * servicesAccess defaults to nothing so loading a food or taxi account through
 * this model never reads back an access list the account does not have.
 */
const adminSchema = buildAdminSchema({
  hashOnSave: true,
  hidePassword: true,
  defaults: { role: 'admin', servicesAccess: undefined },
});

module.exports = mongoose.models.SPAdmin || mongoose.model('SPAdmin', adminSchema, 'admins');
