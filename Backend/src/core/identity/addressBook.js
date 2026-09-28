import mongoose from 'mongoose';
import { platformUserIdFor } from './platformUser.js';

/**
 * One address book for the customer, on their platform account (`users`).
 *
 * Food, Rides and Services already read it. Quick and the Shop kept their own
 * copy on their own customer rows (qc_users, ecom_users), so a customer typed
 * the same home address three times, and a change in one app never reached
 * the others. Those services now read and write the platform account's book.
 *
 * The first time a linked customer's book is used from one of those services,
 * the addresses they had saved only there are copied over -- keeping their ids,
 * so a checkout holding an address id still finds it -- except where the
 * account already has an address with that label (Home, Office, Other are one
 * each; the account's own copy wins). The service row is then marked, so this
 * happens once.
 */

const REQUIRED = ['street', 'city', 'state'];

async function mergeLegacyAddresses(ownCollection, ownId, platformId) {
    const db = mongoose.connection;
    const own = await db.collection(ownCollection).findOne(
        { _id: new mongoose.Types.ObjectId(String(ownId)) },
        { projection: { addresses: 1, addressesMergedAt: 1 } },
    );
    if (!own || own.addressesMergedAt) return;

    const users = db.collection('users');
    const account = await users.findOne(
        { _id: new mongoose.Types.ObjectId(String(platformId)) },
        { projection: { addresses: 1 } },
    );
    if (!account) return;

    const have = new Set((account.addresses || []).map((a) => String(a?.label || '')));
    const hasDefault = (account.addresses || []).some((a) => a?.isDefault);
    const toCopy = [];
    for (const a of own.addresses || []) {
        const label = ['Home', 'Office', 'Other'].includes(a?.label) ? a.label : 'Other';
        if (have.has(label)) continue;
        if (!REQUIRED.every((k) => String(a?.[k] || '').trim())) continue;
        have.add(label);
        toCopy.push({ ...a, label, isDefault: false });
    }
    if (toCopy.length && !hasDefault) toCopy[0].isDefault = true;

    if (toCopy.length) {
        await users.updateOne({ _id: account._id }, { $push: { addresses: { $each: toCopy } } });
    }
    await db.collection(ownCollection).updateOne({ _id: own._id }, { $set: { addressesMergedAt: new Date() } });
}

/**
 * The platform account whose address book this service customer uses, having
 * brought over what they saved in the service first. null when the customer
 * has no platform account -- the service then keeps using its own copy.
 *
 * @param {string} ownId          the service's customer id (qc_users / ecom_users)
 * @param {string} ownCollection  that service's customer collection
 */
export async function addressBookOwner(ownId, ownCollection) {
    const link = await platformUserIdFor(ownId);
    if (!link?.platformId) return null;
    if (link.platformId !== String(ownId)) {
        await mergeLegacyAddresses(ownCollection, ownId, link.platformId);
    }
    return link.platformId;
}
