/**
 * A one-per-customer Shop coupon is used once, even by orders placed together.
 *
 * Run: node tests/shop-coupon-claimed-once.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('shop_coupon_claim');
await mongoose.connect(mongo.getUri('shop_coupon_claim'));

const { Offer } = await import('../src/modules/ecommerce/modules/commerce/admin/models/offer.model.js');
const { OfferUsage } = await import('../src/modules/ecommerce/modules/commerce/admin/models/offerUsage.model.js');
const { Order } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
const { Checkout } = await import('../src/modules/ecommerce/modules/commerce/orders/models/checkout.model.js');
const claims = await import('../src/modules/ecommerce/modules/commerce/orders/services/couponClaim.service.js');
const orders = await import('../src/modules/ecommerce/modules/commerce/orders/services/order.service.js');
await OfferUsage.syncIndexes();

const oid = () => new mongoose.Types.ObjectId();
const offer = await Offer.create({ couponCode: 'ONCE50', discountType: 'flat', discountValue: 50, perUserLimit: 1, status: 'active' }).catch(async () => {
    const r = await Offer.collection.insertOne({ couponCode: 'ONCE50', discountType: 'flat', discountValue: 50, perUserLimit: 1, status: 'active' });
    return { _id: r.insertedId };
});
const usage = async (userId) => (await OfferUsage.findOne({ offerId: offer._id, userId }).lean())?.count ?? 0;

await check('two orders claiming the coupon together: one wins, one is refused', async () => {
    const user = oid();
    const results = await Promise.allSettled([
        claims.claimCouponForCustomer({ couponCode: 'once50', userId: user }),
        claims.claimCouponForCustomer({ couponCode: 'ONCE50', userId: user }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /already used/);
    assert.equal(await usage(user), 1);
});

await check('a coupon with no per-customer limit claims nothing', async () => {
    await Offer.collection.insertOne({ couponCode: 'OPEN', perUserLimit: 0, status: 'active' });
    assert.equal(await claims.claimCouponForCustomer({ couponCode: 'OPEN', userId: oid() }), null);
});

await check("an unpaid order holding the coupon gives way to the customer's retry", async () => {
    const user = oid();
    const held = await claims.claimCouponForCustomer({ couponCode: 'ONCE50', userId: user });
    const _id = oid();
    await Order.collection.insertOne({
        _id, orderId: 'CLM1', userId: user, orderStatus: 'pending_payment', items: [],
        payment: { method: 'razorpay', status: 'created' }, couponClaim: { offerId: held.offerId, releasedAt: null },
    });
    const again = await claims.claimCouponForCustomer({ couponCode: 'ONCE50', userId: user });
    assert.ok(again?.offerId);
    assert.equal((await Order.collection.findOne({ _id })).orderStatus, 'cancelled_by_user');
    assert.equal(await usage(user), 1, 'the old claim was returned, the new one taken');
});

await check('giving up an unpaid order returns its claim, once', async () => {
    const user = oid();
    const held = await claims.claimCouponForCustomer({ couponCode: 'ONCE50', userId: user });
    const doc = {
        _id: oid(), orderId: 'CLM2', userId: user, orderStatus: 'pending_payment', items: [],
        payment: { method: 'razorpay', status: 'created' }, couponClaim: { offerId: held.offerId, releasedAt: null },
    };
    await Order.collection.insertOne(doc);
    assert.equal(await orders.deletePendingPaymentOrder(doc), true);
    assert.equal(await usage(user), 0);
    assert.equal(await claims.releaseCouponClaim(Order, doc._id), false, 'a second release is a no-op');
    assert.equal(await usage(user), 0);
});

await check('an abandoned checkout returns its claim', async () => {
    const user = oid();
    const held = await claims.claimCouponForCustomer({ couponCode: 'ONCE50', userId: user });
    const { abandonCheckout } = await import('../src/modules/ecommerce/modules/commerce/orders/services/orderSplit.service.js');
    await Checkout.collection.insertOne({
        _id: oid(), checkoutId: 'CHK-CLM', userId: user, status: 'pending', pricing: { grandTotal: 500 },
        payment: { method: 'razorpay', status: 'pending' }, couponClaim: { offerId: held.offerId, releasedAt: null },
    });
    await abandonCheckout(user, 'CHK-CLM');
    assert.equal(await usage(user), 0);
});

await check('a paid order with a claim is not counted a second time', async () => {
    const user = oid();
    const held = await claims.claimCouponForCustomer({ couponCode: 'ONCE50', userId: user });
    await orders.incrementCouponUsageForOrder({ _id: oid(), pricing: { couponCode: 'ONCE50', discount: 50 }, couponClaim: held }, user);
    assert.equal(await usage(user), 1);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop coupon claim checks passed');
process.exit(0);
