/**
 * Quick honours a platform coupon, and "once per customer" spans services:
 * used on Food by the same person, it is refused on Quick.
 *
 * Run: node tests/qc-platform-coupon.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_platform_coupon');
await mongoose.connect(mongo.getUri('qc_platform_coupon'));
const db = mongoose.connection;

const BASE = '../src/modules/quickCommerce/modules/food';
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { calculateOrderPricing } = await import(`${BASE}/orders/services/order-pricing.service.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
const { claimPlatformCoupon } = await import('../src/core/promotions/platformCoupon.service.js');
await PlatformCouponUse.syncIndexes();

const zone = await QCZone.collection.insertOne({
    name: 'Central', zoneName: 'Central', isActive: true,
    coordinates: [
        { latitude: 12.0, longitude: 77.0 }, { latitude: 12.0, longitude: 78.0 },
        { latitude: 13.0, longitude: 78.0 }, { latitude: 13.0, longitude: 77.0 },
    ],
});
const store = await FoodRestaurant.collection.insertOne({
    restaurantName: 'Corner Kirana', status: 'approved', isActive: true, zoneId: zone.insertedId, ownerPhone: '9111111111',
    location: { type: 'Point', coordinates: [77.6, 12.9], latitude: 12.9, longitude: 77.6 },
});
await FoodFeeSettings.create({ deliveryFee: 0, deliveryFeeRanges: [], platformFee: 0, gstRate: 0, isActive: true });
const bread = await FoodItem.create({ restaurantId: store.insertedId, name: 'Bread', price: 300, gstRate: 0, approvalStatus: 'approved' });

// One person: a platform account and their Quick row.
const platformId = new mongoose.Types.ObjectId();
const qcId = new mongoose.Types.ObjectId();
await db.collection('users').insertOne({ _id: platformId, phone: '9000000044' });
await db.collection('qc_users').insertOne({ _id: qcId, phone: '9000000044', platformUserId: platformId });

await PlatformCoupon.create({ code: 'EVERY50', services: ['food', 'quickCommerce'], discountType: 'flat', discountValue: 50, perUserLimit: 1 });
await PlatformCoupon.create({ code: 'FOODONLY50', services: ['food'], discountType: 'flat', discountValue: 50 });

const address = { street: '1 MG Road', city: 'Bengaluru', state: 'KA', location: { type: 'Point', coordinates: [77.61, 12.91] } };
const quote = (userId, couponCode) => calculateOrderPricing(String(userId), {
    restaurantId: String(store.insertedId), items: [{ itemId: String(bread._id), quantity: 1 }], deliveryAddress: address, couponCode,
});

await check('a Quick customer gets the platform coupon\'s discount', async () => {
    const r = await quote(qcId, 'EVERY50');
    assert.equal(r.pricing.discount, 50);
    assert.equal(r.pricing.appliedCoupon?.code, 'EVERY50');
});

await check('a Food-only platform coupon is not honoured on Quick', async () => {
    const r = await quote(qcId, 'FOODONLY50');
    assert.equal(r.pricing.discount, 0);
});

await check('used on Food by the same person, it is refused on Quick', async () => {
    assert.equal((await claimPlatformCoupon('EVERY50', { service: 'food', platformUserId: platformId })).taken, true);
    const r = await quote(qcId, 'EVERY50');
    assert.equal(r.pricing.discount, 0);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Quick platform coupon checks passed');
process.exit(0);
