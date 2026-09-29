/**
 * A coupon code belongs to one coupon across the whole platform.
 *
 * Run: node tests/coupon-code-platform-unique.smoke.mjs
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
await mongoose.connect(mongo.getUri('coupon_unique'));

const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');
const { FoodOffer: QCOffer } = await import('../src/modules/quickCommerce/modules/food/admin/models/offer.model.js');
const { Offer: ShopOffer } = await import('../src/modules/ecommerce/modules/commerce/admin/models/offer.model.js');
const { PromoCode } = await import('../src/modules/taxi/admin/promotions/models/PromoCode.js');
const SPCoupon = (await import('../src/modules/serviceProvider/models/Coupon.js')).default;
const { assertCouponCodeFree } = await import('../src/core/promotions/couponCodeRegistry.js');

await FoodOffer.collection.insertOne({ couponCode: 'WELCOME50', discountType: 'percentage', discountValue: 50 });
await QCOffer.collection.insertOne({ couponCode: 'QUICK10', discountType: 'flat', discountValue: 10 });

const refusedAsDuplicate = (promise) => assert.rejects(promise, (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 11000, 'looks like the duplicate each service already handles');
    assert.match(err.message, /already used by a Food coupon/);
    return true;
});

await check('a new Shop, Quick, Rides or Services coupon cannot take a Food code', async () => {
    await refusedAsDuplicate(new ShopOffer({ couponCode: 'welcome50' }).validate());
    await refusedAsDuplicate(new QCOffer({ couponCode: 'WELCOME50' }).validate());
    await refusedAsDuplicate(new PromoCode({ code: 'WELCOME50' }).validate());
    await refusedAsDuplicate(new SPCoupon({ couponCode: 'WELCOME50' }).validate());
});

await check('an edit that renames a coupon to another service\'s code is refused', async () => {
    await refusedAsDuplicate(QCOffer.findOneAndUpdate({ couponCode: 'QUICK10' }, { $set: { couponCode: 'WELCOME50' } }));
    assert.ok(await QCOffer.collection.findOne({ couponCode: 'QUICK10' }), 'unchanged');
});

await check('a free code is accepted, and a coupon keeps its own code on save', async () => {
    await assertCouponCodeFree('SHOPNEW', 'ecom_offers');
    await assertCouponCodeFree('WELCOME50', 'food_offers');
    const food = await FoodOffer.findOne({ couponCode: 'WELCOME50' });
    food.discountValue = 60;
    await food.validate();
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll coupon code checks passed');
process.exit(0);
