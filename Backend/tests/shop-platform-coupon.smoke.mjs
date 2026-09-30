/**
 * The Shop honours a platform coupon: quoted on the whole cart, claimed at
 * placement against the customer's platform account, given back when the
 * unpaid order is abandoned -- and refused if already used on another service.
 *
 * Run: node tests/shop-platform-coupon.smoke.mjs
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
await mongoose.connect(mongo.getUri('shop_platform_coupon'));
const db = mongoose.connection;

const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
const core = await import('../src/core/promotions/platformCoupon.service.js');
const { resolveCoupon } = await import('../src/modules/ecommerce/modules/commerce/orders/services/order-pricing.service.js');
const claims = await import('../src/modules/ecommerce/modules/commerce/orders/services/couponClaim.service.js');
const { Order } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
const { deletePendingPaymentOrder } = await import('../src/modules/ecommerce/modules/commerce/orders/services/order.service.js');
await PlatformCouponUse.syncIndexes();

const person = async (phone) => {
    const platformId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    await db.collection('users').insertOne({ _id: platformId, phone });
    await db.collection('ecom_users').insertOne({ _id: shopId, phone, platformUserId: platformId });
    return { platformId, shopId };
};
const ada = await person('9000000061');
const bo = await person('9000000062');
await PlatformCoupon.create({ code: 'BIGSALE', services: ['food', 'ecommerce'], discountType: 'percentage', discountValue: 10, maxDiscount: 100, perUserLimit: 1 });
const uses = async (who) => (await PlatformCouponUse.findOne({ platformUserId: who.platformId }).lean())?.count || 0;
const cart = new Map([['sellerA', 600], ['sellerB', 400]]);

await check('quoted on the whole cart (10% of Rs 1000, capped at Rs 100)', async () => {
    const r = await resolveCoupon({ userId: String(ada.shopId), codeRaw: 'BIGSALE', subtotalsBySeller: cart });
    assert.equal(r.discount, 100);
    assert.equal(r.appliedCoupon.code, 'BIGSALE');
});

let claim;
await check('claimed at placement, against the platform account', async () => {
    claim = await claims.claimCouponForCustomer({ couponCode: 'BIGSALE', userId: String(ada.shopId) });
    assert.equal(claim.platformCode, 'BIGSALE');
    assert.equal(await uses(ada), 1);
});

await check('abandoning the unpaid order gives the use back', async () => {
    const doc = {
        _id: new mongoose.Types.ObjectId(), orderId: 'PC1', userId: ada.shopId, orderStatus: 'pending_payment', items: [],
        payment: { method: 'razorpay', status: 'created' }, couponClaim: { offerId: null, platformCode: 'BIGSALE', releasedAt: null },
    };
    await Order.collection.insertOne(doc);
    assert.equal(await deletePendingPaymentOrder(doc), true);
    assert.equal(await uses(ada), 0);
});

await check('used on Food by the same person, the Shop refuses it', async () => {
    assert.equal((await core.claimPlatformCoupon('BIGSALE', { service: 'food', platformUserId: bo.platformId })).taken, true);
    const r = await resolveCoupon({ userId: String(bo.shopId), codeRaw: 'BIGSALE', subtotalsBySeller: cart });
    assert.equal(r.discount, 0);
    assert.match(r.couponRefusal.reason, /already used/);
    await assert.rejects(claims.claimCouponForCustomer({ couponCode: 'BIGSALE', userId: String(bo.shopId) }), /already used/);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop platform coupon checks passed');
process.exit(0);
