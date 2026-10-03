import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../../config/env.js';
import { ADMIN_LEVELS, ADMIN_MODULES } from './adminHierarchy.constants.js';

/*
 * The one schema for the shared `admins` collection.
 *
 * Three models read and write these documents: FoodAdmin (this file, used by
 * Food, Quick, the Shop and Master), TaxiAdmin (modules/taxi/admin/models/Admin.js)
 * and SPAdmin (modules/serviceProvider/models/Admin.js). Each used to declare its
 * own schema, and they disagreed: SPAdmin's `role` enum rejected every account
 * Master or taxi made, so saving one through SPAdmin failed validation; taxi
 * switched an admin off with `active`/`status`, which no other panel reads.
 *
 * Now every field lives here once. What genuinely differs per model is passed to
 * buildAdminSchema as options -- not copied -- so a field added for one panel is
 * a field every panel can see.
 */

/**
 * @param {object} [opts]
 * @param {boolean} [opts.hashOnSave=true]   bcrypt `password` in a pre-save hook. Taxi
 *        hashes before it writes, so its model must not hash a second time.
 * @param {boolean} [opts.hidePassword=false] `select: false` on `password`, for the
 *        models whose code asks for it with '+password'.
 * @param {object} [opts.defaults]           role, admin_type and servicesAccess defaults.
 */
export function buildAdminSchema({ hashOnSave = true, hidePassword = false, defaults = {} } = {}) {
    const { role = 'ADMIN', admin_type = 'subadmin' } = defaults;
    // Not a destructuring default: `servicesAccess: undefined` means "no default",
    // and a destructuring default would quietly turn it into ['food'].
    const servicesAccess = 'servicesAccess' in defaults ? defaults.servicesAccess : ['food'];

    const schema = new mongoose.Schema(
        {
            email: {
                type: String,
                required: true,
                unique: true,
                lowercase: true,
                trim: true
            },
            password: {
                type: String,
                required: true,
                select: !hidePassword
            },
            name: { type: String, trim: true, default: '' },
            phone: { type: String, trim: true, default: '' },
            profileImage: { type: String, trim: true, default: '' },
            fcmTokens: {
                type: [String],
                default: []
            },
            fcmTokenMobile: {
                type: [String],
                default: []
            },
            // Free text on purpose: each panel spells it its own way ('ADMIN',
            // 'superadmin', 'super_admin'). adminLevel / admin_type carry the meaning.
            role: {
                type: String,
                trim: true,
                default: role
            },
            /*
             * Whether the account may sign in anywhere. `active` and `status` are
             * taxi's spelling of the same switch; the pre-validate hook below keeps
             * all three agreeing, and isAdminActive() honours any of them.
             */
            isActive: {
                type: Boolean,
                default: true
            },
            active: {
                type: Boolean,
                default: true
            },
            status: {
                type: String,
                enum: ['active', 'inactive'],
                default: 'active',
                trim: true
            },
            servicesAccess: {
                type: [String],
                enum: ['food', 'quickCommerce', 'medical', 'taxi', 'serviceProvider', 'ecommerce'],
                default: servicesAccess
            },
            // --- Admin Hierarchy Fields ---
            adminLevel: {
                type: String,
                enum: Object.values(ADMIN_LEVELS),
                default: ADMIN_LEVELS.SUBADMIN
            },
            module: {
                type: String,
                enum: [...Object.values(ADMIN_MODULES), null],
                default: null
            },
            parentAdminId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'FoodAdmin',
                default: null,
                index: true
            },
            admin_type: {
                type: String,
                enum: ['superadmin', 'subadmin'],
                default: admin_type,
                trim: true
            },
            permissions: {
                type: [String],
                default: []
            },
            /*
             * Whether this admin may delete anything -- zones, restaurants, vehicles,
             * items, anything -- in any panel. Separate from `permissions` because
             * "can edit" and "can destroy" are different trust levels: an admin can
             * run a section day to day without being able to wipe it. Enforced in
             * adminAccessPolicy.decideAdminAccess. Defaults to true so accounts made
             * before the switch keep what they could already do; the form starts
             * new sub-admins with it off.
             */
            canDelete: {
                type: Boolean,
                default: true
            },
            food_zone_ids: {
                type: [
                    {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: 'FoodZone'
                    }
                ],
                default: []
            },
            // Quick commerce and medical zones (qc_zones) a sub-admin is limited to; empty = all.
            qc_zone_ids: {
                type: [mongoose.Schema.Types.ObjectId],
                default: []
            },
            // Taxi's service locations and zones a sub-admin is limited to; empty = all.
            service_location_ids: {
                type: [mongoose.Schema.Types.ObjectId],
                default: []
            },
            zone_ids: {
                type: [mongoose.Schema.Types.ObjectId],
                default: []
            },
            // Taxi's password reset. Hidden from every model: only taxi's reset flow
            // asks for them, with '+resetPasswordOtp' and friends.
            resetPasswordOtp: { type: String, select: false },
            resetPasswordExpires: { type: Date, select: false },
            // Wrong reset codes submitted against the current code. See taxi's adminService.
            resetPasswordAttempts: { type: Number, default: 0, select: false },
            // Services: the city an SP admin is limited to (null = every city).
            cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPCity', default: null },
            cityName: { type: String, default: '' },
            profilePhoto: { type: String, default: null },
            lastLogin: { type: Date }
        },
        {
            collection: 'admins',
            timestamps: true
        }
    );

    schema.index({ servicesAccess: 1 });
    schema.index({ adminLevel: 1, module: 1 });
    schema.index({ parentAdminId: 1, module: 1 });
    schema.index({ admin_type: 1, active: 1 });

    // One on/off switch, three spellings. Whichever the caller changed wins;
    // switching off through any of them switches off all three.
    schema.pre('validate', function syncActiveFlags() {
        const changedTaxi = this.isModified('active') || this.isModified('status');
        let on;
        if (changedTaxi) on = this.active !== false && this.status !== 'inactive';
        else if (this.isModified('isActive')) on = this.isActive !== false;
        else return;
        this.isActive = on;
        this.active = on;
        this.status = on ? 'active' : 'inactive';
    });

    if (hashOnSave) {
        schema.pre('save', async function (next) {
            if (!this.isModified('password')) {
                return next();
            }

            const salt = await bcrypt.genSalt(config.bcryptSaltRounds);
            this.password = await bcrypt.hash(this.password, salt);
            next();
        });
    }

    schema.methods.comparePassword = function (candidatePassword) {
        return bcrypt.compare(candidatePassword, this.password);
    };

    return schema;
}

/**
 * Whether an admin document may sign in. Honours taxi's `active`/`status` as well
 * as `isActive`, for rows written before the three were kept in step.
 */
export const isAdminActive = (admin) =>
    Boolean(admin) &&
    admin.isActive !== false &&
    admin.active !== false &&
    String(admin.status || 'active').toLowerCase() !== 'inactive';

export const FoodAdmin = mongoose.models.FoodAdmin || mongoose.model('FoodAdmin', buildAdminSchema());
