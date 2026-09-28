import mongoose from 'mongoose';
import { CustomerWallet } from './customerWallet.model.js';
import { platformUserIdFor } from '../identity/platformUser.js';

/**
 * The customer's ONE wallet, for a service that keys customers by its own ids.
 *
 * Food and Rides key customers by the platform account, and their wallet
 * (food_user_wallets, customerWallet.model.js) is keyed the same way. Quick and
 * the Shop key customers by their own rows (qc_users, ecom_users), so they each
 * had their own wallet and money did not move between apps.
 *
 * A model built here is that same collection with that same schema -- cloned,
 * so its hooks keeping every transaction row readable by every service come
 * with it -- plus one addition: the service's customer id is translated to the
 * customer's platform account on the way in. Done in the model rather than at
 * each call site, it covers every path that touches the wallet (top-ups,
 * checkout, refunds, cashback, referral rewards, the ledger), including ones
 * added later. A customer with no platform account keeps a wallet keyed by the
 * service's id, in the same collection.
 *
 * Deletes are deliberately NOT translated. A service deleting its own customer
 * row ("delete my Shop account") must never remove the wallet the customer
 * still spends in every other app; untranslated, such a delete only matches a
 * wallet keyed by the service id -- one nobody else shares.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

// Translated on every wallet read and write, so the answer is kept for a few
// minutes; a customer's link does not change mid-session.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

export async function walletOwner(id) {
    if (!isId(id)) return id;
    const key = String(id);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.owner;
    const resolved = await platformUserIdFor(key).catch(() => null);
    const owner = new mongoose.Types.ObjectId(resolved?.platformId || key);
    if (cache.size > 5000) cache.clear();
    cache.set(key, { owner, at: Date.now() });
    return owner;
}

export const clearWalletOwnerCache = () => cache.clear();

/** A filter or update value for userId, translated: an id, or { $in: [...] }. */
async function translateUserId(value) {
    if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId) && Array.isArray(value.$in)) {
        return { ...value, $in: await Promise.all(value.$in.map(walletOwner)) };
    }
    return isId(value) ? walletOwner(value) : value;
}

async function translateQuery() {
    const filter = this.getFilter();
    if (filter && filter.userId !== undefined) {
        this.setQuery({ ...filter, userId: await translateUserId(filter.userId) });
    }
    const update = this.getUpdate?.();
    if (update) {
        for (const op of ['$set', '$setOnInsert']) {
            if (update[op]?.userId !== undefined) update[op].userId = await translateUserId(update[op].userId);
        }
        if (update.userId !== undefined) update.userId = await translateUserId(update.userId);
    }
}

/**
 * The shared wallet, as a model for a service that keys customers by its own ids.
 * @param {string} modelName  a name unique to the service, e.g. 'EcomUserWallet'
 */
export function linkedCustomerWallet(modelName) {
    if (mongoose.models[modelName]) return mongoose.models[modelName];
    const schema = CustomerWallet.schema.clone();
    for (const op of ['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany', 'countDocuments']) {
        schema.pre(op, translateQuery);
    }
    // Wallets created through the model (create / new / save).
    schema.pre('validate', async function translateNewWallet() {
        if (this.isNew && this.userId) this.userId = await walletOwner(this.userId);
    });
    return mongoose.model(modelName, schema, 'food_user_wallets');
}
