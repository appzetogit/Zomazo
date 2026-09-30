/**
 * One coupon code, one coupon, across the whole platform.
 *
 * Every service keeps its own coupons (Food, Quick & Medical, Shop, Rides,
 * Services), each unique only within its own collection -- so WELCOME50 could
 * be five different coupons with five sets of terms, and a customer moving
 * between services in the one app met a code that "worked" differently each
 * time. A new or changed code is now refused while another service holds it.
 * Codes already duplicated are left alone (nothing is renamed); they just
 * cannot be re-saved under that code until one is changed.
 *
 * Checked in each model (couponCodePlugin), so every way a coupon is written --
 * the admin screens, a restaurant's or seller's own coupons, the Master list --
 * gets the same rule without each service remembering to call it.
 *
 * The refusal looks like the database's own duplicate-key error (code 11000)
 * with a 409 status and a plain message, so each service's existing handling of
 * "this code already exists" answers it the way it answers its own duplicates.
 */
import mongoose from 'mongoose';

// Raw collection names, not models: this module must not import the services
// it guards (one is CommonJS), and a lookup needs no schema.
export const COUPON_CODE_HOLDERS = [
    { collection: 'food_offers', field: 'couponCode', label: 'Food' },
    { collection: 'qc_offers', field: 'couponCode', label: 'Quick & Medical' },
    { collection: 'ecom_offers', field: 'couponCode', label: 'Shop' },
    { collection: 'taxipromocodes', field: 'code', label: 'Rides' },
    { collection: 'sp_coupons', field: 'couponCode', label: 'Services' },
    // Master's own coupons, honoured by several services (platformCoupon.model.js).
    { collection: 'platform_coupons', field: 'code', label: 'platform-wide' },
];

const normalize = (code) => String(code || '').trim().toUpperCase();

/** The service (label) another collection's coupon uses this code in, or null. */
export async function couponCodeHolderElsewhere(code, ownCollection) {
    const wanted = normalize(code);
    if (!wanted || mongoose.connection.readyState !== 1) return null;
    for (const holder of COUPON_CODE_HOLDERS) {
        if (holder.collection === ownCollection) continue;
        const hit = await mongoose.connection.db
            .collection(holder.collection)
            .findOne({ [holder.field]: wanted }, { projection: { _id: 1 } });
        if (hit) return holder.label;
    }
    return null;
}

/** Throws the duplicate-code refusal when another service holds `code`. */
export async function assertCouponCodeFree(code, ownCollection) {
    const holder = await couponCodeHolderElsewhere(code, ownCollection);
    if (!holder) return;
    const wanted = normalize(code);
    const err = new Error(`The code ${wanted} is already used by a ${holder} coupon. Codes are shared across every service; choose another.`);
    err.name = 'ConflictError';
    err.code = 11000;
    err.statusCode = 409;
    err.status = 409;
    err.keyValue = { code: wanted };
    throw err;
}

/** The code an update query would set, or undefined. */
const codeInUpdate = (update, field) => {
    if (!update) return undefined;
    if (update[field] !== undefined) return update[field];
    if (update.$set && update.$set[field] !== undefined) return update.$set[field];
    if (update.$setOnInsert && update.$setOnInsert[field] !== undefined) return update.$setOnInsert[field];
    return undefined;
};

/**
 * Mongoose plugin: refuse a code another service holds, on create, on save
 * with a changed code, and on update queries that set it.
 */
export function couponCodePlugin(schema, { field, collection }) {
    schema.pre('validate', async function checkCouponCode() {
        if (!this.isNew && !this.isModified(field)) return;
        await assertCouponCodeFree(this.get(field), collection);
    });
    schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], async function checkCouponCodeUpdate() {
        const code = codeInUpdate(this.getUpdate(), field);
        if (code === undefined) return;
        await assertCouponCodeFree(code, collection);
    });
}
