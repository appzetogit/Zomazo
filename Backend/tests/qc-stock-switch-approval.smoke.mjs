/**
 * Quick: flipping a product's in-stock switch from the item editor (which posts
 * the whole product) does not send it back for approval; a real edit does.
 *
 * Run: node tests/qc-stock-switch-approval.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_stock_switch');
await mongoose.connect(mongo.getUri('qc_stock_switch'));

const { updateRestaurantFood } = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurantFood.service.js');
const { FoodItem } = await import('../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');

const restaurantId = new mongoose.Types.ObjectId();
await FoodRestaurant.collection.insertOne({ _id: restaurantId, restaurantName: 'Test Mart' });

const seed = async () => {
    const _id = new mongoose.Types.ObjectId();
    await FoodItem.collection.insertOne({
        _id, restaurantId, name: 'Milk 1 L', description: 'Toned', price: 60, otherPrice: 0,
        image: 'https://img/milk.jpg', images: ['https://img/milk.jpg'], foodType: 'Veg',
        variants: [], isAvailable: true, approvalStatus: 'approved', isApproved: true,
    });
    return _id;
};

await check('the whole product posted with only the stock switch flipped stays approved', async () => {
    const id = await seed();
    const out = await updateRestaurantFood(restaurantId, id, {
        name: 'Milk 1 L', description: 'Toned', price: 60, image: 'https://img/milk.jpg', foodType: 'Veg', isAvailable: false,
    });
    assert.equal(out.isAvailable, false);
    assert.equal(out.approvalStatus, 'approved');
});

await check('a real price change still goes back for approval', async () => {
    const id = await seed();
    const out = await updateRestaurantFood(restaurantId, id, { name: 'Milk 1 L', price: 65 });
    assert.equal(out.approvalStatus, 'pending');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
