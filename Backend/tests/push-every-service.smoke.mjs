/**
 * A customer's platform-login devices get every service's pushes.
 *
 * Run: node tests/push-every-service.smoke.mjs
 *
 * Web login registers the browser's FCM token on the platform account (`users`)
 * only. Quick, Services and the Shop push to their own customer rows (qc_users,
 * sp_users, ecom_users), so a customer who only ever signed in once, on the
 * platform, got no Quick, Services or Shop pushes at all.
 * What this guards:
 *   - Quick and Shop's token lists for a customer include the platform
 *     account's devices (linked by platformUserId, else the same phone), per
 *     platform bucket, without duplicates;
 *   - Services' per-customer sender and its admin broadcasts reach them too;
 *   - partners (riders, sellers, vendors) are not given a customer's devices;
 *   - a deactivated platform account lends no devices;
 *   - a token FCM calls dead is dropped from the platform account as well;
 *   - Shop customer pushes are filed in the one inbox, as 'ecommerce'.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'push_every_service' });
const db = mongoose.connection;

const identity = await import('../src/core/identity/platformUser.js');
const quick = await import('../src/modules/quickCommerce/core/notifications/firebase.service.js');
const shop = await import('../src/modules/ecommerce/core/notifications/firebase.service.js');
const { FoodNotification } = await import('../src/core/notifications/models/notification.model.js');
const fcm = require('../src/modules/serviceProvider/services/firebaseAdmin.js');
const broadcastService = require('../src/modules/serviceProvider/services/broadcastService.js');
const SpUser = require('../src/modules/serviceProvider/models/User.js');
const Broadcast = require('../src/modules/serviceProvider/models/Broadcast.js');
const SpNotification = require('../src/modules/serviceProvider/models/Notification.js');
for (const M of [SpUser, Broadcast, SpNotification]) await M.createCollection().catch(() => {});

const pushed = [];
fcm.sendPushNotification = async (tokens, payload) => {
  pushed.push({ tokens: [...tokens], payload });
  return { successCount: tokens.length, failureCount: 0 };
};

const oid = () => new mongoose.Types.ObjectId();

// Asha signed in once, on the platform, from a browser and a phone.
const asha = oid();
await db.collection('users').insertOne({
  _id: asha, name: 'Asha', phone: '9876543210', isActive: true,
  fcmTokens: ['web-asha'], fcmTokenMobile: ['app-asha'],
});
const ashaQuick = oid();
const ashaQuickByPhone = oid();
const ashaShop = oid();
const ashaServices = oid();
await db.collection('qc_users').insertMany([
  { _id: ashaQuick, phone: '9876543210', platformUserId: asha, fcmTokens: ['web-asha', 'qc-only'] },
  { _id: ashaQuickByPhone, phone: '+91 98765 43210' },
]);
await db.collection('ecom_users').insertOne({ _id: ashaShop, phone: '9876543210', platformUserId: asha });
await db.collection('sp_users').insertOne({ _id: ashaServices, name: 'Asha', phone: '9876543210', platformUserId: asha, isActive: true });

// Ravi's platform account is switched off.
const ravi = oid();
const raviQuick = oid();
await db.collection('users').insertOne({ _id: ravi, phone: '9111111111', isActive: false, fcmTokens: ['web-ravi'] });
await db.collection('qc_users').insertOne({ _id: raviQuick, phone: '9111111111', platformUserId: ravi });

console.log('\nQuick');
await check('a linked Quick customer gets her platform devices, own tokens kept, no duplicates', async () => {
  const tokens = await quick.listOwnerTokens({ ownerType: 'USER', ownerId: String(ashaQuick) });
  assert.deepEqual([...tokens].sort(), ['app-asha', 'qc-only', 'web-asha']);
});
await check('a Quick row with no link is matched by phone', async () => {
  const tokens = await quick.listOwnerTokens({ ownerType: 'USER', ownerId: String(ashaQuickByPhone) });
  assert.deepEqual([...tokens].sort(), ['app-asha', 'web-asha']);
});
await check('a web-only send reads only the web bucket', async () => {
  const tokens = await quick.listOwnerTokens({ ownerType: 'USER', ownerId: String(ashaQuickByPhone), platform: 'web' });
  assert.deepEqual(tokens, ['web-asha']);
  const app = await quick.listOwnerTokens({ ownerType: 'USER', ownerId: String(ashaQuickByPhone), platform: 'android' });
  assert.deepEqual(app, ['app-asha']);
});
await check('a deactivated platform account lends no devices', async () => {
  assert.deepEqual(await quick.listOwnerTokens({ ownerType: 'USER', ownerId: String(raviQuick) }), []);
});
await check('a rider id is never given a customer\'s devices', async () => {
  // The same id as a customer's, asked for as a delivery partner.
  assert.deepEqual(await quick.listOwnerTokens({ ownerType: 'DELIVERY_PARTNER', ownerId: String(ashaQuick) }), []);
});

console.log('\nShop');
await check('a Shop customer gets her platform devices', async () => {
  const tokens = await shop.listOwnerTokens({ ownerType: 'USER', ownerId: String(ashaShop) });
  assert.deepEqual([...tokens].sort(), ['app-asha', 'web-asha']);
});
await check('a seller id is never given a customer\'s devices', async () => {
  assert.deepEqual(await shop.listOwnerTokens({ ownerType: 'SELLER', ownerId: String(ashaShop) }), []);
});
await check('a Shop customer push is filed in the one inbox as ecommerce', async () => {
  await shop.sendNotificationToOwner({
    ownerType: 'USER', ownerId: String(ashaShop),
    payload: { title: 'Order shipped', body: 'Your kurta is on its way', data: { orderId: 'EC-1' } },
  });
  const n = await FoodNotification.findOne({ title: 'Order shipped' }).lean();
  assert.ok(n, 'not filed');
  assert.equal(String(n.ownerId), String(asha));
  assert.equal(n.vertical, 'ecommerce');
  assert.equal(n.source, 'ORDER');
});

console.log('\nServices');
await check('a booking update reaches her platform devices', async () => {
  pushed.length = 0;
  await fcm.sendNotificationToUser(String(ashaServices), { title: 'Professional assigned', body: 'Ravi will come at 5' });
  assert.equal(pushed.length, 1, 'nothing pushed');
  assert.deepEqual([...pushed[0].tokens].sort(), ['app-asha', 'web-asha']);
});
await check('a web-only update reads only the web bucket', async () => {
  pushed.length = 0;
  await fcm.sendNotificationToUser(String(ashaServices), { title: 'x', body: 'y' }, false);
  assert.deepEqual(pushed[0]?.tokens, ['web-asha']);
});
await check('an admin broadcast to customers reaches her platform devices', async () => {
  pushed.length = 0;
  const { done } = await broadcastService.createBroadcast({ title: 'Diwali', message: 'Offers inside', audiences: ['customers'] });
  const result = await done;
  const all = pushed.flatMap((p) => p.tokens);
  assert.ok(all.includes('web-asha') && all.includes('app-asha'), `pushed ${JSON.stringify(all)}`);
  assert.equal(result.devices, 2);
});

console.log('\nDead tokens');
await check('a token FCM calls dead is dropped from the platform account too', async () => {
  await identity.dropPlatformDeviceTokens(['web-asha']);
  const main = await db.collection('users').findOne({ _id: asha });
  assert.deepEqual(main.fcmTokens, []);
  assert.deepEqual(main.fcmTokenMobile, ['app-asha']);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
