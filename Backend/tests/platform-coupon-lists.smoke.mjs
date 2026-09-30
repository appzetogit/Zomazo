/**
 * A platform coupon shows in every service's "available coupons" list, in that
 * service's own shape, and drops out once the customer has used it up.
 *
 * Run: node tests/platform-coupon-lists.smoke.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);

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
await mongoose.connect(mongo.getUri('platform_coupon_lists'));
const db = mongoose.connection;

const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
const core = await import('../src/core/promotions/platformCoupon.service.js');
const food = await import('../src/modules/food/restaurant/services/restaurant.service.js');
const quick = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurant.service.js');
const shop = await import('../src/modules/ecommerce/modules/commerce/seller/services/seller.service.js');
const taxi = await import('../src/modules/taxi/services/promoService.js');
const sp = require('../src/modules/serviceProvider/services/couponService.js');
await PlatformCouponUse.syncIndexes();

const platformId = new mongoose.Types.ObjectId();
const ids = { qc: new mongoose.Types.ObjectId(), ecom: new mongoose.Types.ObjectId(), sp: new mongoose.Types.ObjectId() };
await db.collection('users').insertOne({ _id: platformId, phone: '9000000081' });
await db.collection('qc_users').insertOne({ _id: ids.qc, phone: '9000000081', platformUserId: platformId });
await db.collection('ecom_users').insertOne({ _id: ids.ecom, phone: '9000000081', platformUserId: platformId });
await db.collection('sp_users').insertOne({ _id: ids.sp, phone: '9000000081', platformUserId: platformId });

await PlatformCoupon.create({
    code: 'EVERYONE60', title: 'Rs 60 off anywhere', services: ['food', 'quickCommerce', 'ecommerce', 'taxi', 'serviceProvider'],
    discountType: 'flat', discountValue: 60, minOrderValue: 200, perUserLimit: 1,
});
await PlatformCoupon.create({ code: 'PAUSED10', services: ['food'], discountType: 'flat', discountValue: 10, status: 'paused' });

const lists = {
    food: async () => (await food.listPublicOffers()).allOffers,
    quick: async () => (await quick.listPublicOffers({ userId: String(ids.qc) })).allOffers,
    shop: async () => (await shop.listPublicOffers({ userId: String(ids.ecom) })).allOffers,
    taxi: async () => taxi.listAvailablePromosForUser({ userId: String(platformId) }),
    services: async () => sp.listAvailableCoupons(String(ids.sp)),
};
const codeOf = (row) => row.couponCode || row.code;

await check('listed in every service, in its own shape', async () => {
    for (const [name, list] of Object.entries(lists)) {
        const row = (await list()).find((r) => codeOf(r) === 'EVERYONE60');
        assert.ok(row, `${name}: not listed`);
        if (name === 'taxi') {
            assert.equal(row.discount_type, 'flat');
            assert.equal(row.flat_discount_amount, 60);
            assert.equal(row.minimum_trip_amount, 200);
        } else {
            assert.equal(row.discountType, 'flat-price', name);
            assert.equal(Number(row.discountValue), 60, name);
            assert.equal(Number(row.minOrderValue), 200, name);
        }
    }
});

await check('a paused one is not listed', async () => {
    assert.ok(!(await lists.food()).some((r) => codeOf(r) === 'PAUSED10'));
});

await check('used up by the customer, it drops out of the lists that know them', async () => {
    assert.equal((await core.claimPlatformCoupon('EVERYONE60', { service: 'food', platformUserId: platformId })).taken, true);
    for (const name of ['quick', 'shop', 'taxi', 'services']) {
        assert.ok(!(await lists[name]()).some((r) => codeOf(r) === 'EVERYONE60'), `${name} still lists it`);
    }
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll platform coupon list checks passed');
process.exit(0);
