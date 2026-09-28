/**
 * A late Razorpay capture never revives a cancelled Shop order or checkout.
 *
 * Run: node tests/shop-late-capture.smoke.mjs
 *
 * The refund itself goes to Razorpay, which is not configured here: the
 * handler logs "refund manually" and still leaves the order cancelled and
 * unpaid, which is what these checks pin.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

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
process.env.MONGODB_URI = mongo.getUri('shop_late_capture');
await mongoose.connect(mongo.getUri('shop_late_capture'));

const { Order } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
const { Checkout } = await import('../src/modules/ecommerce/modules/commerce/orders/models/checkout.model.js');
const { handleEcomRazorpayEvent } = await import('../src/modules/ecommerce/core/payments/controllers/razorpayWebhook.controller.js');

const oid = () => new mongoose.Types.ObjectId();
const captured = (orderId, paymentId, amount) => ({ payment: { entity: { order_id: orderId, id: paymentId, amount } } });

await check('a capture on a cancelled order does not mark it paid or bring it back', async () => {
    const _id = oid();
    await Order.collection.insertOne({
        _id, orderId: 'LATE1', orderStatus: 'cancelled_by_user', pricing: { total: 500 },
        payment: { method: 'razorpay', status: 'failed', razorpay: { orderId: 'order_late1' } },
    });
    assert.equal(await handleEcomRazorpayEvent('payment.captured', captured('order_late1', 'pay_late1', 50000)), true);
    const o = await Order.collection.findOne({ _id });
    assert.equal(o.orderStatus, 'cancelled_by_user');
    assert.notEqual(o.payment.status, 'paid');
});

await check('a repeat of the capture already recorded changes nothing', async () => {
    const _id = oid();
    await Order.collection.insertOne({
        _id, orderId: 'LATE2', orderStatus: 'delivered', pricing: { total: 500 },
        payment: { method: 'razorpay', status: 'refunded', razorpay: { orderId: 'order_late2', paymentId: 'pay_late2' } },
    });
    assert.equal(await handleEcomRazorpayEvent('payment.captured', captured('order_late2', 'pay_late2', 50000)), true);
    const o = await Order.collection.findOne({ _id });
    assert.equal(o.payment.status, 'refunded');
    assert.equal(o.orderStatus, 'delivered');
});

await check('a paid order that is no longer pending is not advanced again', async () => {
    const _id = oid();
    await Order.collection.insertOne({
        _id, orderId: 'LATE3', orderStatus: 'created', pricing: { total: 500 },
        payment: { method: 'razorpay', status: 'pending', razorpay: { orderId: 'order_late3' } },
    });
    await handleEcomRazorpayEvent('payment.captured', captured('order_late3', 'pay_late3', 50000));
    assert.equal((await Order.collection.findOne({ _id })).payment.status, 'pending');
});

await check('a capture on an abandoned checkout does not mark it paid', async () => {
    const _id = oid();
    await Checkout.collection.insertOne({
        _id, checkoutId: 'CHK-LATE', userId: oid(), status: 'cancelled', pricing: { grandTotal: 800 },
        payment: { method: 'razorpay', status: 'failed', gatewayOrderId: 'order_chk_late' },
    });
    assert.equal(await handleEcomRazorpayEvent('payment.captured', captured('order_chk_late', 'pay_chk_late', 80000)), true);
    const c = await Checkout.collection.findOne({ _id });
    assert.equal(c.status, 'cancelled');
    assert.notEqual(c.payment.status, 'paid');
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop late-capture checks passed');
process.exit(0);
