/**
 * scripts/fixShopNotificationIndex.mjs swaps the old sparse index for the
 * partial one, after which a customer can hold more than one notification.
 *
 * Run: node tests/shop-notification-index-script.smoke.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri('shop_notif_index');
await mongoose.connect(uri);
const col = mongoose.connection.collection('ecom_notifications');
await col.insertOne({ ownerType: 'USER', ownerId: new mongoose.Types.ObjectId(), title: 'seed' });
await col.createIndex({ broadcastId: 1, ownerType: 1, ownerId: 1 }, { unique: true, sparse: true });

const runScript = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/fixShopNotificationIndex.mjs', ...args], {
        env: { ...process.env, MONGO_URI: uri, NODE_ENV: 'test' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out}`))));
});

const dry = await runScript([]);
assert.match(dry, /would be dropped/);
assert.ok((await col.indexes()).some((i) => i.sparse), 'a dry run changes nothing');

await runScript(['--apply']);
const idx = (await col.indexes()).find((i) => i.name === 'broadcastId_1_ownerType_1_ownerId_1');
assert.ok(idx?.partialFilterExpression, 'the partial index is in place');

const owner = new mongoose.Types.ObjectId();
await col.insertMany([{ ownerType: 'USER', ownerId: owner, title: 'one' }, { ownerType: 'USER', ownerId: owner, title: 'two' }]);
assert.equal(await col.countDocuments({ ownerId: owner }), 2, 'two direct notifications for one customer');

assert.match(await runScript(['--apply']), /nothing to do/, 'a second run does nothing');

await mongoose.disconnect();
await mongo.stop();
console.log('All notification index script checks passed');
process.exit(0);
