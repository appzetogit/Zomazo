/**
 * The restaurant panel serves food restaurants and QC stores off one set of
 * paths, rewriting only /food -> /qc. Every seller route the panel calls has to
 * exist on both routers, or a store's screen hits a 404.
 *
 * Run: node tests/seller-profile-routes.smoke.mjs
 *
 * What this guards:
 *   - DELETE /profile/account (the panel's "Delete account") on both;
 *   - PATCH /my-offers/:id (coupon edit) on both;
 *   - the FSSAI / contact fields the profile screens save are accepted by both
 *     profile updaters (and send the outlet to re-verification).
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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
process.env.MONGO_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);

const foodRouter = (await import('../src/modules/food/restaurant/routes/restaurant.routes.js')).default;
const qcRouter = (await import('../src/modules/quickCommerce/modules/food/restaurant/routes/restaurant.routes.js')).default;

const has = (router, method, path) =>
  router.stack.some((layer) => layer.route?.path === path && layer.route.methods?.[method]);

console.log('\nroutes');
for (const [name, router] of [['food', foodRouter], ['qc', qcRouter]]) {
  await check(`${name}: DELETE /profile/account`, () => assert.ok(has(router, 'delete', '/profile/account')));
  await check(`${name}: PATCH /my-offers/:id`, () => assert.ok(has(router, 'patch', '/my-offers/:id')));
  await check(`${name}: PATCH /profile`, () => assert.ok(has(router, 'patch', '/profile')));
}

console.log('\nprofile fields');
const food = await import('../src/modules/food/restaurant/services/restaurant.service.js');
const qc = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurant.service.js');
for (const [name, svc, coll] of [['food', food, 'food_restaurants'], ['qc', qc, 'qc_restaurants']]) {
  const _id = new mongoose.Types.ObjectId();
  await mongoose.connection.collection(coll).insertOne({ _id, restaurantName: `${name} outlet`, ownerPhone: '9876500000', status: 'approved' });
  await check(`${name}: FSSAI and contact number are saved`, async () => {
    await svc.updateRestaurantProfile(String(_id), {
      fssaiNumber: '12345678901234', fssaiExpiry: '2030-01-31', fssaiImage: 'https://cdn.example/fssai.webp',
      primaryContactNumber: '9123456780',
    });
    const doc = await mongoose.connection.collection(coll).findOne({ _id });
    assert.equal(doc.fssaiNumber, '12345678901234');
    assert.equal(new Date(doc.fssaiExpiry).toISOString().slice(0, 10), '2030-01-31');
    assert.equal(doc.fssaiImage, 'https://cdn.example/fssai.webp');
    assert.equal(doc.primaryContactNumber, '9123456780');
    assert.equal(doc.status, 'pending', 'licence changes go back to review');
  });
}

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll seller profile route checks passed');
process.exit(failed ? 1 : 0);
