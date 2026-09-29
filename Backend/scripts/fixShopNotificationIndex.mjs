/**
 * Replace the Shop's old sparse broadcast index on ecom_notifications.
 *
 * The index deduping a broadcast's fan-out (broadcastId, ownerType, ownerId)
 * was sparse. A sparse COMPOUND index only skips a row when every indexed field
 * is missing, and ownerType/ownerId never are -- so every direct notification
 * (no broadcastId) was indexed as (null, owner) and each customer could hold
 * only one. The model now declares it partial (broadcastId is an ObjectId), but
 * Mongoose does not change an index that already exists under the same key, so
 * the old one has to be dropped once.
 *
 *   node scripts/fixShopNotificationIndex.mjs            # dry run: says what it would do
 *   node scripts/fixShopNotificationIndex.mjs --apply    # drops it and builds the partial one
 *
 * Safe to run again: with the partial index in place it does nothing. It never
 * drops any other index.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('fixShopNotificationIndex: MONGO_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
const { Notification } = await import('../src/modules/ecommerce/core/notifications/models/notification.model.js');
const collection = Notification.collection;

const sameKey = (key) => JSON.stringify(key) === JSON.stringify({ broadcastId: 1, ownerType: 1, ownerId: 1 });
const indexes = await collection.indexes().catch((err) => (err?.codeName === 'NamespaceNotFound' ? [] : Promise.reject(err)));
const stale = indexes.filter((i) => sameKey(i.key) && !i.partialFilterExpression);

if (stale.length === 0) {
  console.log(`${collection.collectionName}: no old sparse broadcast index; nothing to do.`);
} else {
  for (const index of stale) {
    console.log(`${collection.collectionName}: old index "${index.name}" (sparse: ${Boolean(index.sparse)}) ${apply ? 'dropped' : 'would be dropped'}`);
    if (apply) await collection.dropIndex(index.name);
  }
  if (apply) {
    // Creates what the schema declares and is missing; drops nothing.
    await Notification.createIndexes();
    console.log(`${collection.collectionName}: partial broadcast index built.`);
  } else {
    console.log('Dry run. Re-run with --apply to change the index.');
  }
}

await mongoose.disconnect();
