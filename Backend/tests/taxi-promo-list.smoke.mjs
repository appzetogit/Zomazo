/**
 * The rider's promo list: with no service location (the profile's promo page)
 * it lists live codes everywhere; with one (Select vehicle) it narrows to that
 * location and transport type, as before.
 *
 * Run: node tests/taxi-promo-list.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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
await mongoose.connect(mongo.getUri(), { dbName: 'taxi_promo_list' });

const { PromoCode } = await import('../src/modules/taxi/admin/promotions/models/PromoCode.js');
const { listAvailablePromosForUser } = await import('../src/modules/taxi/services/promoService.js');

const cityA = new mongoose.Types.ObjectId();
const cityB = new mongoose.Types.ObjectId();
const day = 24 * 60 * 60 * 1000;
const base = {
  active: true,
  audience_type: 'all',
  discount_percentage: 10,
  from_date: new Date(Date.now() - day),
  to_date: new Date(Date.now() + day),
  createdAt: new Date(),
};
// Raw inserts: only the fields the list reads matter here.
await PromoCode.collection.insertMany([
  { ...base, code: 'CITYA', service_location_id: cityA, transport_type: 'taxi' },
  { ...base, code: 'CITYB', service_location_id: cityB, transport_type: 'all' },
  { ...base, code: 'PARCEL', service_location_id: cityA, transport_type: 'delivery' },
  { ...base, code: 'OLD', service_location_id: cityA, transport_type: 'all', to_date: new Date(Date.now() - day) },
  { ...base, code: 'OFF', service_location_id: cityA, transport_type: 'all', active: false },
]);
const userId = String(new mongoose.Types.ObjectId());
const codes = (list) => list.map((p) => p.code).sort();

await check('no location: every live code, any transport, nothing expired or off', async () => {
  assert.deepEqual(codes(await listAvailablePromosForUser({ userId })), ['CITYA', 'CITYB', 'PARCEL']);
});

await check('a location and transport type narrow it, as at booking', async () => {
  const list = await listAvailablePromosForUser({ userId, service_location_id: String(cityA), transport_type: 'taxi' });
  assert.deepEqual(codes(list), ['CITYA']);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll promo list checks passed');
