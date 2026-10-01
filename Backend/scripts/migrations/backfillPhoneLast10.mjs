/**
 * Stamp the indexed last-10-digit phone fields on rows written before they
 * existed (core/identity/phoneLast10.cjs).
 *
 *   node scripts/migrations/backfillPhoneLast10.mjs            # dry run (default): counts what it would stamp
 *   node scripts/migrations/backfillPhoneLast10.mjs --apply    # writes, in batches; safe to re-run
 *
 * Sign-in looks rows up by these fields, with a regex fallback that reads only
 * rows still missing them. Until this has run that fallback is what finds old
 * rows; afterwards it reads nothing. Deploy the code first: the model hooks stamp
 * every new and changed row from then on. Also builds the indexes, so the
 * lookups are index hits on the first request rather than after autoIndex.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toLast10 } = require('../../src/core/identity/phoneLast10.cjs');

const BATCH = 500;

// [model file, export, [rawField, last10Field, blank]]; blank is what a row with no
// digits gets ('' where it is safe, nothing where a partial unique index needs it
// unset). Collection names come from the models, since the Shop's are prefixed.
const OWNER = [['ownerPhone', 'ownerPhoneLast10'], ['primaryContactNumber', 'primaryContactLast10', '']];
const PHONE = [['phone', 'phoneLast10']];
export const PHONE_LAST10_TARGETS = [
    ['../../src/modules/food/restaurant/models/restaurant.model.js', 'FoodRestaurant', OWNER],
    ['../../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js', 'FoodRestaurant', OWNER],
    ['../../src/modules/ecommerce/modules/commerce/seller/models/seller.model.js', 'Seller', OWNER],
    ['../../src/modules/food/delivery/models/deliveryPartner.model.js', 'FoodDeliveryPartner', PHONE],
    ['../../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js', 'FoodDeliveryPartner', PHONE],
    ['../../src/modules/ecommerce/modules/commerce/delivery/models/deliveryPartner.model.js', 'DeliveryPartner', PHONE],
    ['../../src/modules/taxi/driver/models/Driver.js', 'Driver', PHONE],
    ['../../src/core/users/user.model.js', 'FoodUser', PHONE],
];

export async function backfillPhoneLast10({ apply = false, batch = BATCH, log = console.log, db = mongoose.connection } = {}) {
    const out = {};
    for (const [file, name, pairs] of PHONE_LAST10_TARGETS) {
        const Model = (await import(file))[name];
        const collection = Model.collection.collectionName;
        const coll = db.collection(collection);
        // Only rows that still need it: the field is missing and there is a raw value.
        const pending = { $or: pairs.map(([raw, last10]) => ({ [last10]: null, [raw]: { $exists: true } })) };
        const total = await coll.countDocuments(pending);
        let stamped = 0;
        if (apply) {
            for (const [, last10] of pairs) await coll.createIndex({ [last10]: 1 });
            let lastId = null;
            for (;;) {
                const filter = lastId ? { $and: [pending, { _id: { $gt: lastId } }] } : pending;
                const projection = Object.fromEntries(pairs.flatMap(([raw, last10]) => [[raw, 1], [last10, 1]]));
                const docs = await coll.find(filter, { projection }).sort({ _id: 1 }).limit(batch).toArray();
                if (!docs.length) break;
                const ops = [];
                for (const doc of docs) {
                    const set = {};
                    for (const [raw, last10, blank] of pairs) {
                        if (doc[last10] != null) continue;
                        const ten = toLast10(doc[raw]);
                        if (ten) set[last10] = ten;
                        else if (blank !== undefined) set[last10] = blank;
                    }
                    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
                }
                if (ops.length) await coll.bulkWrite(ops, { ordered: false });
                stamped += ops.length;
                lastId = docs[docs.length - 1]._id;
            }
        }
        out[collection] = apply ? { stamped } : { toStamp: total };
        log(`${collection}: ${apply ? `${stamped} stamped` : `${total} to stamp`}`);
    }
    if (!apply) log('Dry run: nothing written. Re-run with --apply.');
    return out;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('backfillPhoneLast10: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await backfillPhoneLast10({ apply: process.argv.includes('--apply') });
    } finally {
        await mongoose.disconnect();
    }
}
