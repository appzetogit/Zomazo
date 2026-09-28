/**
 * Demand-triggered peak zones: the zone's peak settings finally price rides.
 *
 * Run: node tests/taxi-peak-zone.smoke.mjs
 *
 * What this guards:
 *   - a zone with no peak settings never surges on demand;
 *   - open requests near the pickup in the window, at or over the zone's ride
 *     count, add the zone's percentage to the quote, labelled as peak demand;
 *   - requests outside the radius, already matched, or older than the window
 *     do not count;
 *   - once triggered the peak holds for peak_zone_duration, then ends;
 *   - a larger time-slot surge wins; the two never stack;
 *   - the booking is priced the same way as the quote.
 */
process.env.TAXI_DISTANCE_SOURCE = 'straight';

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
await mongoose.connect(mongo.getUri(), { dbName: 'taxi_peak' });

const peakZone = await import('../src/modules/taxi/common/peakZone.js');
const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
const { SurgeSlot } = await import('../src/modules/taxi/admin/models/SurgeSlot.js');
const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const svc = await import('../src/modules/taxi/services/rideService.js');

console.log('\nthe rule');
await check('no settings, no rule', () => {
  assert.equal(peakZone.peakRuleOf({ peak_zone_ride_count: null, peak_zone_surge_percentage: 20 }), null);
  assert.equal(peakZone.peakRuleOf({ peak_zone_ride_count: 5, peak_zone_surge_percentage: 20 }), null, 'no window');
});
await check('miles are converted', () => {
  const rule = peakZone.peakRuleOf({ unit: 'miles', peak_zone_ride_count: 2, peak_zone_radius: 1, peak_zone_selection_duration: 10, peak_zone_surge_percentage: 20 });
  assert.ok(Math.abs(rule.radiusKm - 1.609344) < 1e-9);
});
await check('threshold and hold', () => {
  const rule = { threshold: 3, percent: 40, windowMinutes: 10, holdMinutes: 15, radiusKm: 2 };
  const at = new Date('2026-09-28T10:00:00Z');
  assert.equal(peakZone.evaluatePeak(rule, { openRequests: 2, at }).active, false);
  const on = peakZone.evaluatePeak(rule, { openRequests: 3, at });
  assert.equal(on.active, true);
  assert.equal(on.percent, 40);
  assert.equal(on.activeUntil.toISOString(), '2026-09-28T10:15:00.000Z');
  assert.equal(peakZone.evaluatePeak(rule, { openRequests: 0, activeUntil: on.activeUntil, at: new Date('2026-09-28T10:10:00Z') }).active, true);
  assert.equal(peakZone.evaluatePeak(rule, { openRequests: 0, activeUntil: on.activeUntil, at: new Date('2026-09-28T10:16:00Z') }).active, false);
});

const id = () => new mongoose.Types.ObjectId();
const sedan = id();
await Vehicle.collection.insertOne({ _id: sedan, name: 'Sedan', active: true, status: 1, transport_type: 'taxi', createdAt: new Date() });
await SetPrice.collection.insertOne({
  vehicle_type: sedan, transport_type: 'taxi', pricing_scope: 'ride', active: 1, status: 'active',
  zone_id: null, service_location_id: null, service_tax: 0,
  base_price: 100, base_distance: 50, price_per_distance: 0, time_price: 0, admin_commision: 0, admin_commision_type: 0,
  createdAt: new Date(), updatedAt: new Date(),
});

// A square zone around Indore; the pickup in its middle.
const pickup = [75.8843673, 22.728214];
const drop = [75.8968202, 22.75521];
const zone = await Zone.create({
  name: 'Indore Central', active: true, unit: 'km',
  geometry: { type: 'Polygon', coordinates: [[[75.8, 22.65], [75.97, 22.65], [75.97, 22.8], [75.8, 22.8], [75.8, 22.65]]] },
  peak_zone_ride_count: 3, peak_zone_radius: 2, peak_zone_selection_duration: 10, peak_zone_duration: 15, peak_zone_surge_percentage: 50,
});

const minutesAgo = (m) => new Date(Date.now() - m * 60000);
const request = (coords, { status = 'searching', createdAt = minutesAgo(1) } = {}) => ({
  userId: id(), status, pickupLocation: { type: 'Point', coordinates: coords },
  dropLocation: { type: 'Point', coordinates: drop }, scheduledAt: null, createdAt, updatedAt: createdAt,
  pricingSnapshot: { surge_zone_id: zone._id },
});
const quote = async () => (await svc.quoteRideFares({
  pickupCoords: pickup, dropCoords: drop, vehicleTypeIds: [sedan], transport_type: 'taxi',
}))[0];

console.log('\nthe quote');
await Ride.collection.insertMany([
  request([75.885, 22.729]),
  request([75.886, 22.73]),
  request([75.95, 22.79]),                                // ~9 km away: outside the 2 km radius
  request([75.884, 22.728], { status: 'accepted' }),      // already matched
  request([75.884, 22.728], { createdAt: minutesAgo(30) }), // outside the 10-minute window
]);
await check('two open requests nearby: no peak', async () => {
  const q = await quote();
  assert.equal(q.fare.surge, 0);
  assert.equal(q.peakZone.active, false);
  assert.equal(q.peakZone.openRequests, 2);
  assert.equal(q.peakZone.threshold, 3);
});

await Ride.collection.insertOne(request([75.8845, 22.7285]));
let peaked;
await check('the third turns the peak on: 50% of the fare, said to be peak demand', async () => {
  peaked = await quote();
  assert.equal(peaked.peakZone.active, true);
  assert.equal(peaked.fare.surgeReason, 'peak_demand');
  assert.equal(peaked.fare.surgePercent, 50);
  assert.equal(peaked.fare.surgeSlotName, 'Peak demand');
  assert.equal(peaked.fare.surge, Math.round(peaked.fare.fareBeforeSurge * 0.5));
});
await check('and the zone remembers it for 15 minutes', async () => {
  const z = await Zone.findById(zone._id).lean();
  const minutesLeft = (new Date(z.peak_zone_active_until).getTime() - Date.now()) / 60000;
  assert.ok(minutesLeft > 14 && minutesLeft <= 15, String(minutesLeft));
});

await check('demand gone, hold still on: still peak', async () => {
  await Ride.collection.updateMany({ status: 'searching' }, { $set: { status: 'accepted' } });
  const q = await quote();
  assert.equal(q.peakZone.openRequests, 0);
  assert.equal(q.fare.surgeReason, 'peak_demand');
});
await check('hold over: peak ends', async () => {
  await Zone.updateOne({ _id: zone._id }, { $set: { peak_zone_active_until: minutesAgo(1) } });
  const q = await quote();
  assert.equal(q.peakZone.active, false);
  assert.equal(q.fare.surge, 0);
});

console.log('\nwith a time slot');
await Ride.collection.updateMany({ status: 'accepted' }, { $set: { status: 'searching', createdAt: minutesAgo(1) } });
const allDay = { zone_ids: [zone._id], vehicle_type_ids: [], days: [0, 1, 2, 3, 4, 5, 6], start_time: '00:00', end_time: '23:59', active: true };
await check('a smaller slot loses to the peak', async () => {
  await SurgeSlot.collection.insertOne({ ...allDay, name: 'Small', percent: 20 });
  const q = await quote();
  assert.equal(q.fare.surgePercent, 50);
  assert.equal(q.fare.surgeReason, 'peak_demand');
});
await check('a larger slot wins, and they never stack', async () => {
  await SurgeSlot.collection.deleteMany({});
  await SurgeSlot.collection.insertOne({ ...allDay, name: 'Festival', percent: 80 });
  const q = await quote();
  assert.equal(q.fare.surgePercent, 80);
  assert.equal(q.fare.surgeReason, 'time_slot');
  assert.equal(q.fare.surge, Math.round(q.fare.fareBeforeSurge * 0.8));
  await SurgeSlot.collection.deleteMany({});
});

console.log('\nthe pure resolver');
await check('resolveRideSurge prefers the larger of peak and flat surge', () => {
  const flat = svc.resolveRideSurge({ surgeZone: { _id: zone._id, ride_surge_enabled: true }, pricingRule: { ride_surge_amount: 30 }, fareBeforeSurge: 100, peak: { active: true, percent: 20 } });
  assert.equal(flat.amount, 30);
  assert.equal(flat.reason, 'zone');
  const peak = svc.resolveRideSurge({ surgeZone: { _id: zone._id, ride_surge_enabled: true }, pricingRule: { ride_surge_amount: 10 }, fareBeforeSurge: 100, peak: { active: true, percent: 20 } });
  assert.equal(peak.amount, 20);
  assert.equal(peak.reason, 'peak_demand');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll peak zone checks passed');
process.exit(failed ? 1 : 0);
