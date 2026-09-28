/**
 * A Shop rider cannot guess the customer's handover code, and a seller cannot
 * skip the rider by marking its own order picked up or delivered.
 *
 * Run: node tests/shop-handover-guess.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('shop_handover');
await mongoose.connect(mongo.getUri('shop_handover'));

const { Order } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
const delivery = await import('../src/modules/ecommerce/modules/commerce/orders/services/order-delivery.service.js');

const rider = new mongoose.Types.ObjectId();
const orderId = new mongoose.Types.ObjectId();
await Order.collection.insertOne({
    _id: orderId,
    orderId: 'SHOPTEST1',
    userId: new mongoose.Types.ObjectId(),
    sellerId: new mongoose.Types.ObjectId(),
    items: [{ itemId: 'i1', name: 'Kettle', price: 900, quantity: 1 }],
    deliveryAddress: { street: '1 MG Road', city: 'Pune', state: 'MH' },
    pricing: { subtotal: 900, total: 900 },
    payment: { method: 'cash', status: 'cod_pending' },
    orderStatus: 'reached_drop',
    deliveryOtp: '4321',
    dispatch: { deliveryPartnerId: rider },
    deliveryState: { pickedUpAt: new Date() },
    deliveryVerification: { dropOtp: { required: true, verified: false } },
});
const codeNow = async () => (await Order.collection.findOne({ _id: orderId })).deliveryOtp;

await check('wrong codes count down, and the fifth replaces the code', async () => {
    for (let i = 1; i <= 4; i += 1) {
        await assert.rejects(delivery.verifyDropOtpDelivery(String(orderId), rider, '0000'), new RegExp(`${5 - i} tr`));
    }
    assert.equal(await codeNow(), '4321');
    await assert.rejects(delivery.verifyDropOtpDelivery(String(orderId), rider, '0000'), /new code/);
    assert.notEqual(await codeNow(), '4321');
});

await check('the old code no longer works; the new one does', async () => {
    await assert.rejects(delivery.verifyDropOtpDelivery(String(orderId), rider, '4321'), /Invalid OTP/);
    await delivery.verifyDropOtpDelivery(String(orderId), rider, await codeNow());
    assert.equal((await Order.collection.findOne({ _id: orderId })).deliveryVerification.dropOtp.verified, true);
});

await check('a seller cannot mark its own order picked up or delivered', async () => {
    const { updateOrderStatusSeller } = await import('../src/modules/ecommerce/modules/commerce/orders/services/order.service.js');
    const seller = (await Order.collection.findOne({ _id: orderId })).sellerId;
    for (const step of ['picked_up', 'reached_drop', 'delivered']) {
        await assert.rejects(updateOrderStatusSeller(String(orderId), String(seller), step), /delivery partner/);
    }
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop handover checks passed');
process.exit(0);
