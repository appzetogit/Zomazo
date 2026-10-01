import mongoose from 'mongoose';

/**
 * Services whose customers have been merged into `users` (serviceCustomer.js):
 * their customer id IS the platform id, and an old row id resolves through the
 * service's id map. Shared readers (my orders, support, referrals, invite
 * codes, push tokens) consult this instead of special-casing each service.
 */
export const MERGED_CUSTOMER_MAPS = Object.freeze({
    qc_users: 'qc_user_id_map',
    ecom_users: 'ecom_user_id_map',
});

/** True when `collection` is a merged service's customer rows. */
export const isMergedCustomerCollection = (collection) => Object.prototype.hasOwnProperty.call(MERGED_CUSTOMER_MAPS, collection);

/** The platform id an old merged-service row id maps to, with its service collection, or null. */
export async function mappedCustomer(id) {
    if (!/^[a-f0-9]{24}$/i.test(String(id || ''))) return null;
    const _id = new mongoose.Types.ObjectId(String(id));
    for (const [collection, map] of Object.entries(MERGED_CUSTOMER_MAPS)) {
        const hit = await mongoose.connection.collection(map).findOne({ _id }, { projection: { platformId: 1 } });
        if (hit?.platformId) return { platformId: hit.platformId, collection };
    }
    return null;
}
