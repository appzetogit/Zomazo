/**
 * The food cart follows a signed-in customer across devices: what one device
 * saves (PUT /food/user/cart), another reads back (GET), add-ons included; an
 * emptied cart is removed.
 *
 * Run: node tests/food-cart-sync.smoke.mjs
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
await mongoose.connect(mongo.getUri(), { dbName: 'food_cart_sync' });
const { getUserCart, syncUserCart } = await import('../src/modules/food/user/services/userCart.service.js');

const userId = String(new mongoose.Types.ObjectId());
const restaurantId = String(new mongoose.Types.ObjectId());
const line = {
  lineItemId: 'burger|cheese',
  itemId: String(new mongoose.Types.ObjectId()),
  name: 'Burger',
  price: 120,
  quantity: 2,
  restaurantId,
  restaurant: 'Burger Barn',
  addons: [{ addonId: 'cheese', name: 'Cheese', price: 20 }],
};

await check('no saved cart reads as null', async () => {
  assert.equal(await getUserCart(userId), null);
});

await check('a saved cart reads back on another device, add-ons and all', async () => {
  await syncUserCart(userId, [line]);
  const cart = await getUserCart(userId);
  assert.equal(cart.restaurantId, restaurantId);
  assert.equal(cart.restaurantName, 'Burger Barn');
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].lineItemId, 'burger|cheese');
  assert.equal(cart.items[0].quantity, 2);
  assert.deepEqual(cart.items[0].addons.map((a) => [a.addonId, a.price]), [['cheese', 20]]);
});

await check('an emptied cart is removed from the account', async () => {
  await syncUserCart(userId, []);
  assert.equal(await getUserCart(userId), null);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll food cart sync checks passed');
