/**
 * A timed "out of stock" ends on the server, not in the seller's browser.
 *
 * Run: node tests/stock-resume-sweep.smoke.mjs
 *
 * What this guards:
 *   - Food stores the resume time the Inventory page sends (it used to drop it);
 *     switching back on clears it; a time already past is not stored;
 *   - the sweep puts due items back on sale (food: isAvailable + isActive) and
 *     leaves manual offs and not-yet-due items alone;
 *   - Quick: a due item comes back, but not one that has run out of counted stock;
 *   - the seller menu reports the resume time on both, so the panel can show it.
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
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());

const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodItem: QcItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { updateRestaurantFood } = await import('../src/modules/food/restaurant/services/restaurantFood.service.js');
const { sweepStockResumes } = await import('../src/core/orders/stockResumeSweeper.js');
const qcMenu = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurantMenu.service.js');

const minutes = (m) => new Date(Date.now() + m * 60000);
const restaurant = await FoodRestaurant.create({
  restaurantName: 'Sweep Kitchen', ownerName: 'Owner', status: 'approved',
  email: `sweep${Date.now()}@example.com`, phone: `9${String(Date.now()).slice(-9)}`,
});
const dish = (name, extra = {}) => FoodItem.create({
  restaurantId: restaurant._id, name, price: 100, basePrice: 100, foodType: 'Veg',
  approvalStatus: 'approved', isAvailable: true, isActive: true, ...extra,
});

console.log('\nfood: the resume time is stored');
const timed = await dish('Timed');
await check('off for 2 hours keeps the time', async () => {
  const until = minutes(120);
  await updateRestaurantFood(String(restaurant._id), String(timed._id), { isAvailable: false, stockResumeAt: until.toISOString() });
  const doc = await FoodItem.findById(timed._id).lean();
  assert.equal(doc.isAvailable, false);
  assert.equal(new Date(doc.stockResumeAt).getTime(), until.getTime());
  assert.equal(doc.approvalStatus, 'approved', 'a stock switch is not an edit');
});
await check('switching on clears it', async () => {
  await updateRestaurantFood(String(restaurant._id), String(timed._id), { isAvailable: true });
  const doc = await FoodItem.findById(timed._id).lean();
  assert.equal(doc.isAvailable, true);
  assert.equal(doc.stockResumeAt, null);
});
await check('a time already past is not stored', async () => {
  await updateRestaurantFood(String(restaurant._id), String(timed._id), { isAvailable: false, stockResumeAt: minutes(-5).toISOString() });
  const doc = await FoodItem.findById(timed._id).lean();
  assert.equal(doc.stockResumeAt, null);
  await updateRestaurantFood(String(restaurant._id), String(timed._id), { isAvailable: true });
});

console.log('\nthe sweep');
const due = await dish('Due', { isAvailable: false, isActive: false, stockResumeAt: minutes(-1) });
const later = await dish('Later', { isAvailable: false, isActive: false, stockResumeAt: minutes(30) });
const manual = await dish('Manual', { isAvailable: false, isActive: false });
const qcStore = new mongoose.Types.ObjectId();
const qcDue = await QcItem.create({ restaurantId: qcStore, name: 'Milk', price: 30, isAvailable: false, stockResumeAt: minutes(-1), stockOffMode: 'specific-time' });
const qcEmpty = await QcItem.create({ restaurantId: qcStore, name: 'Bread', price: 40, isAvailable: false, stockResumeAt: minutes(-1), stockQty: 0 });
const qcLater = await QcItem.create({ restaurantId: qcStore, name: 'Eggs', price: 60, isAvailable: false, stockResumeAt: minutes(45), stockOffMode: 'specific-time' });

const res = await sweepStockResumes();
await check('due food dish is back on sale', async () => {
  const doc = await FoodItem.findById(due._id).lean();
  assert.equal(doc.isAvailable, true);
  assert.equal(doc.isActive, true);
  assert.equal(doc.stockResumeAt, null);
});
await check('not-yet-due and manual offs are untouched', async () => {
  assert.equal((await FoodItem.findById(later._id).lean()).isAvailable, false);
  assert.equal((await FoodItem.findById(manual._id).lean()).isAvailable, false);
});
await check('due quick item is back, counted-out one is not', async () => {
  assert.equal((await QcItem.findById(qcDue._id).lean()).isAvailable, true);
  assert.equal((await QcItem.findById(qcEmpty._id).lean()).isAvailable, false);
  assert.equal((await QcItem.findById(qcLater._id).lean()).isAvailable, false);
});
await check('counts are reported', () => {
  assert.equal(res.food, 1);
  assert.equal(res.quick, 1);
});
await check('a second run finds nothing', async () => {
  assert.deepEqual(await sweepStockResumes(), { food: 0, quick: 0 });
});

await check('quick menu reports when a timed-off item returns', async () => {
  const menu = await qcMenu.getRestaurantMenu(String(qcStore));
  const items = (menu.sections || []).flatMap((s) => s.items || []);
  const eggs = items.find((i) => i.name === 'Eggs');
  assert.equal(eggs?.stockResumeAt, new Date(qcLater.stockResumeAt).toISOString());
  assert.equal(eggs?.stockOffMode, 'specific-time');
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll stock resume checks passed');
process.exit(failed ? 1 : 0);
