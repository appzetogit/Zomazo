/**
 * Platform coupons: made once, honoured by the services they name, and counted
 * per customer account across all of them.
 *
 * Run: node tests/platform-coupon-core.smoke.mjs
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
await mongoose.connect(mongo.getUri('platform_coupon'));

const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
const svc = await import('../src/core/promotions/platformCoupon.service.js');
const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');
await PlatformCouponUse.syncIndexes();

const user = new mongoose.Types.ObjectId();
await PlatformCoupon.create({
    code: 'SUPER100', title: 'Rs 100 off anywhere', services: ['food', 'ecommerce'],
    discountType: 'flat', discountValue: 100, minOrderValue: 300, perUserLimit: 1, usageLimit: 2,
});
await PlatformCoupon.create({
    code: 'FIRST20', services: ['food'], discountType: 'percentage', discountValue: 20, maxDiscount: 50, audience: 'first_order',
});

await check('quoted in a service it names, refused in one it does not', async () => {
    const food = await svc.quotePlatformCoupon('super100', { service: 'food', platformUserId: user, subtotal: 400 });
    assert.equal(food.discount, 100);
    const taxi = await svc.quotePlatformCoupon('SUPER100', { service: 'taxi', platformUserId: user, subtotal: 400 });
    assert.equal(taxi.discount, 0);
    assert.match(taxi.reason, /cannot be used here/);
});

await check('an unknown code is left to the service (coupon: null)', async () => {
    const r = await svc.quotePlatformCoupon('NOPE', { service: 'food', subtotal: 400 });
    assert.equal(r.coupon, null);
});

await check('minimum order, first-order audience and the percentage cap', async () => {
    assert.match((await svc.quotePlatformCoupon('SUPER100', { service: 'food', platformUserId: user, subtotal: 200 })).reason, /Add items worth/);
    assert.match((await svc.quotePlatformCoupon('FIRST20', { service: 'food', platformUserId: user, subtotal: 1000, isFirstOrder: false })).reason, /first order/);
    assert.equal((await svc.quotePlatformCoupon('FIRST20', { service: 'food', platformUserId: user, subtotal: 1000, isFirstOrder: true })).discount, 50);
});

await check('once per customer ACROSS services: used on Food, refused on the Shop', async () => {
    assert.equal((await svc.claimPlatformCoupon('SUPER100', { service: 'food', platformUserId: user })).taken, true);
    const shop = await svc.quotePlatformCoupon('SUPER100', { service: 'ecommerce', platformUserId: user, subtotal: 500 });
    assert.match(shop.reason, /already used/);
    assert.equal((await svc.claimPlatformCoupon('SUPER100', { service: 'ecommerce', platformUserId: user })).taken, false);
});

await check('two claims at once by one customer: one wins', async () => {
    const other = new mongoose.Types.ObjectId();
    await PlatformCoupon.create({ code: 'RACE1', services: ['food', 'ecommerce'], discountType: 'flat', discountValue: 10, perUserLimit: 1 });
    const r = await Promise.all([
        svc.claimPlatformCoupon('RACE1', { service: 'food', platformUserId: other }),
        svc.claimPlatformCoupon('RACE1', { service: 'ecommerce', platformUserId: other }),
    ]);
    assert.equal(r.filter((x) => x.taken).length, 1);
    assert.equal((await PlatformCoupon.findOne({ code: 'RACE1' }).lean()).usedCount, 1);
});

await check('the total limit holds, and a refused total gives the customer\'s use back', async () => {
    const second = new mongoose.Types.ObjectId();
    const third = new mongoose.Types.ObjectId();
    assert.equal((await svc.claimPlatformCoupon('SUPER100', { service: 'food', platformUserId: second })).taken, true);
    assert.equal((await svc.claimPlatformCoupon('SUPER100', { service: 'food', platformUserId: third })).taken, false, 'usageLimit 2 reached');
    const use = await PlatformCouponUse.findOne({ platformUserId: third }).lean();
    assert.equal(use?.count || 0, 0);
});

await check('release gives a use back to the coupon and the customer', async () => {
    await svc.releasePlatformCoupon('SUPER100', { platformUserId: user });
    const shop = await svc.quotePlatformCoupon('SUPER100', { service: 'ecommerce', platformUserId: user, subtotal: 500 });
    assert.equal(shop.discount, 100);
});

await check('a platform code cannot be taken by a service coupon, nor the reverse', async () => {
    await assert.rejects(new FoodOffer({ couponCode: 'SUPER100', discountValue: 5 }).validate(), /platform-wide coupon/);
    await FoodOffer.collection.insertOne({ couponCode: 'FOODONLY', discountValue: 5 });
    await assert.rejects(PlatformCoupon.create({ code: 'FOODONLY', services: ['food'], discountType: 'flat', discountValue: 5 }), /Food coupon/);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll platform coupon checks passed');
process.exit(0);
