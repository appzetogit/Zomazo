/**
 * A Shop customer can hold more than one direct (non-broadcast) notification,
 * while a broadcast still fans out one row per owner.
 *
 * Run: node tests/shop-notifications-index.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('shop_notif');
await mongoose.connect(mongo.getUri('shop_notif'));

const { Notification } = await import('../src/modules/ecommerce/core/notifications/models/notification.model.js');
await Notification.init();
const ownerId = new mongoose.Types.ObjectId();
const base = { ownerType: 'USER', ownerId, title: 't', message: 'm' };

await check('two direct notifications for one owner are both kept', async () => {
    await Notification.collection.insertOne({ ...base });
    await Notification.collection.insertOne({ ...base });
    assert.equal(await Notification.countDocuments({ ownerId }), 2);
});

await check('one broadcast still reaches an owner only once', async () => {
    const broadcastId = new mongoose.Types.ObjectId();
    await Notification.collection.insertOne({ ...base, broadcastId });
    await assert.rejects(Notification.collection.insertOne({ ...base, broadcastId }), /E11000/);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
}
console.log('\nall passed');
