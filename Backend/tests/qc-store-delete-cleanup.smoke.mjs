/**
 * Deleting a quick-commerce store clears its configuration (commission,
 * offers, categories, showcase slots, carts) and keeps its orders.
 *
 * Run: node tests/qc-store-delete-cleanup.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_store_delete');
await mongoose.connect(mongo.getUri('qc_store_delete'));

const { deleteCurrentRestaurantAccount } = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurant.service.js');
const db = mongoose.connection.db;

const storeId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();
await db.collection('qc_restaurants').insertOne({ _id: storeId, restaurantName: 'Gone Mart' });
const config = ['qc_restaurant_commissions', 'qc_categories', 'qc_offers', 'qc_dining_restaurants', 'qc_gourmet_restaurants'];
for (const name of config) {
    // Distinct values for fields some of these collections index as unique
    // (qc_offers.couponCode): two rows with none of them collide once the index
    // has been built, which made this test fail at random.
    await db.collection(name).insertMany([
        { restaurantId: storeId, couponCode: `GONE-${name}`, name: `gone-${name}`, slug: `gone-${name}` },
        { restaurantId: otherId, couponCode: `KEPT-${name}`, name: `kept-${name}`, slug: `kept-${name}` },
    ]);
}
await db.collection('qc_user_carts').insertMany([{ restaurantId: String(storeId) }, { restaurantId: String(otherId) }]);
await db.collection('qc_orders').insertOne({ restaurantId: storeId });

await deleteCurrentRestaurantAccount(String(storeId));

await check('the store is gone', async () => {
    assert.equal(await db.collection('qc_restaurants').countDocuments({ _id: storeId }), 0);
});
await check('its configuration rows are gone, other stores\' are kept', async () => {
    for (const name of config) {
        assert.equal(await db.collection(name).countDocuments({ restaurantId: storeId }), 0, name);
        assert.equal(await db.collection(name).countDocuments({ restaurantId: otherId }), 1, name);
    }
});
await check('carts keyed by the string id are cleared too', async () => {
    assert.equal(await db.collection('qc_user_carts').countDocuments({ restaurantId: String(storeId) }), 0);
    assert.equal(await db.collection('qc_user_carts').countDocuments(), 1);
});
await check('orders are history and stay', async () => {
    assert.equal(await db.collection('qc_orders').countDocuments({ restaurantId: storeId }), 1);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
