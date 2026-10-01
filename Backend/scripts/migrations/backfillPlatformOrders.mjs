/**
 * Backfill platform_orders -- the one common order record -- from every
 * service's own records.
 *
 *   node scripts/migrations/backfillPlatformOrders.mjs              # dry run (default): counts what it would write
 *   node scripts/migrations/backfillPlatformOrders.mjs --apply      # writes, in batches, resumable
 *   node scripts/migrations/backfillPlatformOrders.mjs --apply --resync   # starts over from the first record
 *
 * Sources: food_orders, qc_orders, ecom_orders, taxirides, sp_bookings
 * (core/orders/platformOrders.service.js maps each). Deploy the code first:
 * from then on the model hooks keep new and changed records in step, and this
 * fills in everything older. Each service is walked in _id order in batches;
 * the last _id done is kept in platform_orders_meta, so a stopped run carries
 * on where it was, and a finished one does nothing more on its next run.
 * --resync walks everything again (after raw-driver writes the hooks cannot
 * see, for instance). When every service is done, platform_orders_meta
 * { _id: 'backfilled' } tells My Orders it can read platform_orders alone.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

const BATCH = 500;

export async function backfillPlatformOrders({ apply = false, resync = false, batch = BATCH, log = console.log } = {}) {
    const { PLATFORM_ORDER_SOURCES, buildPlatformOrder, BACKFILL_MARKER, clearBackfilledCache } =
        await import('../../src/core/orders/platformOrders.service.js');
    const db = mongoose.connection;
    const meta = db.collection(BACKFILL_MARKER.collection);
    const out = {};

    for (const [service, collection] of Object.entries(PLATFORM_ORDER_SOURCES)) {
        const checkpointId = `backfill:${service}`;
        const checkpoint = resync ? null : await meta.findOne({ _id: checkpointId });
        let lastId = checkpoint?.lastId || null;
        const filter = () => (lastId ? { _id: { $gt: lastId } } : {});
        const total = await db.collection(collection).countDocuments(filter());
        let written = 0;
        if (apply) {
            for (;;) {
                const docs = await db.collection(collection).find(filter()).sort({ _id: 1 }).limit(batch).toArray();
                if (!docs.length) break;
                const ops = [];
                for (const doc of docs) {
                    const row = await buildPlatformOrder(service, doc);
                    if (row) ops.push({ updateOne: { filter: { service, sourceId: row.sourceId }, update: { $set: row }, upsert: true } });
                }
                if (ops.length) await db.collection('platform_orders').bulkWrite(ops, { ordered: false });
                written += ops.length;
                lastId = docs[docs.length - 1]._id;
                await meta.updateOne({ _id: checkpointId }, { $set: { lastId, at: new Date() } }, { upsert: true });
            }
        }
        out[service] = { [apply ? 'written' : 'toWrite']: apply ? written : total };
        log(`${collection} -> platform_orders (${service}): ${apply ? `${written} written` : `${total} to write`}`);
    }

    if (apply) {
        await meta.updateOne({ _id: BACKFILL_MARKER._id }, { $setOnInsert: { at: new Date() } }, { upsert: true });
        clearBackfilledCache();
        log('Every service is copied: My Orders now reads platform_orders.');
    } else {
        log('Dry run: nothing written.');
    }
    return out;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('backfillPlatformOrders: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await backfillPlatformOrders({ apply: process.argv.includes('--apply'), resync: process.argv.includes('--resync') });
    } finally {
        await mongoose.disconnect();
    }
}
