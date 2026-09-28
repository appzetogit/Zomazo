/**
 * A Shop return takes back the order's cashback, pro rata, once.
 *
 * Run: node tests/shop-return-cashback.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('shop_return_cashback');
await mongoose.connect(mongo.getUri('shop_return_cashback'));
const db = mongoose.connection;

const { Order } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
const { reverseOrderCashback } = await import('../src/modules/ecommerce/modules/commerce/user/services/cashback.service.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');

const platformId = new mongoose.Types.ObjectId();
const shopUserId = new mongoose.Types.ObjectId();
await db.collection('users').insertOne({ _id: platformId, phone: '9000000055' });
await db.collection('ecom_users').insertOne({ _id: shopUserId, phone: '9000000055', platformUserId: platformId });

const orderId = new mongoose.Types.ObjectId();
await Order.collection.insertOne({ _id: orderId, order_id: 'SHOP-CB1', userId: shopUserId, orderStatus: 'delivered', pricing: { total: 1000 } });
await CustomerWallet.create({
    userId: platformId,
    balance: 100,
    transactions: [{ type: 'addition', amount: 50, description: 'Cashback', metadata: { source: 'cashback', orderId: String(orderId) } }],
});
const balance = async () => (await CustomerWallet.findOne({ userId: platformId }).lean()).balance;

await check('half the order refunded takes back half the cashback, from the one wallet', async () => {
    const r = await reverseOrderCashback(orderId, { refundedAmount: 500, orderTotal: 1000, key: 'return:a' });
    assert.equal(r.reversed, 25);
    assert.equal(await balance(), 75);
});

await check('the same return again takes nothing more', async () => {
    assert.equal((await reverseOrderCashback(orderId, { refundedAmount: 500, orderTotal: 1000, key: 'return:a' })).reversed, 0);
    assert.equal(await balance(), 75);
});

await check('a second return never takes more than was awarded', async () => {
    assert.equal((await reverseOrderCashback(orderId, { refundedAmount: 1000, orderTotal: 1000, key: 'return:b' })).reversed, 25);
    assert.equal(await balance(), 50);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop return cashback checks passed');
process.exit(0);
