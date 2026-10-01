import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../../config/env.js';
import { ADMIN_ACTIONS, ADMIN_PERMISSION_SECTIONS } from '../../constants/permissions.js';

const adminPermissionsSchema = new mongoose.Schema(
    Object.fromEntries(
        ADMIN_PERMISSION_SECTIONS.map((section) => [
            section,
            {
                type: [String],
                enum: ADMIN_ACTIONS,
                default: []
            }
        ])
    ),
    { _id: false, strict: true }
);

const adminSchema = new mongoose.Schema(
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
            required: true
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
        role: {
            type: String,
            default: 'ADMIN'
        },
        adminType: {
            type: String,
            enum: ['super_admin', 'sub_admin'],
            default: 'super_admin'
        },
        permissions: {
            type: adminPermissionsSchema,
            default: () => ({})
        },
        isActive: {
            type: Boolean,
            default: true
        },
        isDeleted: {
            type: Boolean,
            default: false
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCAdmin',
            default: null
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QCAdmin',
            default: null
        },
        servicesAccess: {
            type: [String],
            enum: ['food', 'quickCommerce', 'taxi'],
            default: ['food']
        }
    },
    {
        collection: 'food_admins',
        timestamps: true
    }
);

adminSchema.index({ servicesAccess: 1 });
adminSchema.index({ adminType: 1, isDeleted: 1, isActive: 1 });

adminSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }

    const salt = await bcrypt.genSalt(config.bcryptSaltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

adminSchema.methods.comparePassword = function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

/**
 * The old Quick admins. Read only by the merge (core/admin/quickAdmin.js,
 * scripts/migrations/mergeQcAdmins.mjs); nothing writes a new one.
 */
export const LegacyQcAdmin = mongoose.models.QCAdmin || mongoose.model('QCAdmin', adminSchema, 'qc_admins');

/*
 * Quick's admins ARE the platform's: the shared `admins` collection, with the
 * shared permission model (servicesAccess + resource.read/write, enforced by
 * core/admin/enforceAdminAccess.middleware.js). An old qc_admins id in a token
 * is translated at the edge (auth.middleware.js -> resolveQuickAdminId).
 */
export { FoodAdmin } from '../../../../core/admin/admin.model.js';

