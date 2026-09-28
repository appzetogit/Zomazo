/**
 * A food restaurant can delete its own dish, as a quick-commerce seller already
 * could.
 *
 * Run: node tests/restaurant-food-delete.smoke.mjs
 *
 * The food router had no DELETE /foods/:id, and the item page's Delete button
 * only navigated back -- the dish stayed on the menu. The delete is scoped to
 * the owner's restaurant, takes any combo built on the dish off sale, and pulls
 * the dish out of sibling "goes well with" lists.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '300000';

// Modules first, database second: the router pulls in a large module graph,
// and on a loaded machine an idle in-memory mongod started before it can be
// gone by the time the first query runs.
const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { deleteRestaurantFood } = await import('../src/modules/food/restaurant/services/restaurantFood.service.js');
const foodRouter = (await import('../src/modules/food/restaurant/routes/restaurant.routes.js')).default;

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri();
await mongoose.connect(server.getUri(), { dbName: 'food_delete' });

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};

const mkRestaurant = (name) => FoodRestaurant.create({
    restaurantName: name, ownerName: 'Owner', status: 'approved',
    email: `${name.replace(/\W/g, '')}${Date.now()}@example.com`,
    phone: `9${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9)}`,
});
const mine = await mkRestaurant('Delete Kitchen');
const theirs = await mkRestaurant('Other Kitchen');

const dish = (restaurant, name, extra = {}) => FoodItem.create({
    restaurantId: restaurant._id, name, price: 100, basePrice: 100, foodType: 'Veg',
    approvalStatus: 'approved', isAvailable: true, isActive: true, ...extra,
});

const naan = await dish(mine, 'Naan');
const curry = await dish(mine, 'Curry', { suggestedItemIds: [naan._id] });
const pending = await dish(mine, 'Pending Dish', { approvalStatus: 'pending' });
const combo = await dish(mine, 'Naan + Curry', {
    isCombo: true,
    comboComponents: [
        { itemId: naan._id, quantity: 1, nameSnapshot: 'Naan' },
        { itemId: curry._id, quantity: 1, nameSnapshot: 'Curry' },
    ],
});
const foreign = await dish(theirs, 'Their Dish');

console.log('\nthe route exists');
await check('DELETE /foods/:id is registered on the food restaurant router', async () => {
    const has = foodRouter.stack.some((layer) =>
        layer.route?.path === '/foods/:id' && layer.route.methods?.delete);
    assert.ok(has, 'no DELETE /foods/:id on the food router');
});

console.log('\ndeleting a dish');
await check('the owner deletes their dish', async () => {
    const out = await deleteRestaurantFood(String(mine._id), String(naan._id));
    assert.equal(out?.id, String(naan._id));
    assert.equal(await FoodItem.countDocuments({ _id: naan._id }), 0);
});
await check('a combo containing it is taken off sale', async () => {
    const doc = await FoodItem.findById(combo._id).lean();
    assert.equal(doc.isAvailable, false);
    assert.equal(doc.comboAutoDisabled, true);
});
await check('sibling suggestions no longer point at it', async () => {
    const doc = await FoodItem.findById(curry._id).lean();
    assert.deepEqual((doc.suggestedItemIds || []).map(String), []);
});
await check('a dish still awaiting approval can be deleted too (as in quick commerce)', async () => {
    const out = await deleteRestaurantFood(String(mine._id), String(pending._id));
    assert.ok(out);
});

console.log('\nwhat it refuses');
await check('another restaurant\'s dish is "not found", and survives', async () => {
    const out = await deleteRestaurantFood(String(mine._id), String(foreign._id));
    assert.equal(out, null);
    assert.equal(await FoodItem.countDocuments({ _id: foreign._id }), 1);
});
await check('a malformed id is a validation error', async () => {
    await assert.rejects(() => deleteRestaurantFood(String(mine._id), 'nope'), /Invalid food id/);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
