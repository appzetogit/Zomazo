/**
 * Quick's moves on the customer's ONE wallet never overwrite another's.
 *
 * Run: node tests/qc-wallet-moves-atomic.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_wallet_atomic');
await mongoose.connect(mongo.getUri('qc_wallet_atomic'));
const db = mongoose.connection;

const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const qcWallet = await import('../src/modules/quickCommerce/modules/food/user/services/userWallet.service.js');
const foodWallet = await import('../src/modules/food/user/services/userWallet.service.js');
const qcCashback = await import('../src/modules/quickCommerce/modules/food/user/services/cashback.service.js');

const platformId = new mongoose.Types.ObjectId();
const qcId = new mongoose.Types.ObjectId();
await db.collection('users').insertOne({ _id: platformId, phone: '9000000066' });
await db.collection('qc_users').insertOne({ _id: qcId, phone: '9000000066', platformUserId: platformId });
await CustomerWallet.create({ userId: platformId, balance: 100 });
const wallet = () => CustomerWallet.findOne({ userId: platformId }).lean();

await check('a Quick referral credit and Food refunds landing together all count', async () => {
    await Promise.all([
        qcWallet.creditReferralReward(String(qcId), 25),
        ...Array.from({ length: 5 }, (_, i) => foodWallet.refundWalletBalance
            ? foodWallet.refundWalletBalance(String(platformId), 10, `food refund ${i}`)
            : Promise.resolve()),
        qcWallet.creditReferralReward(String(qcId), 25),
    ]);
    const w = await wallet();
    assert.equal(w.balance, 100 + 50 + 50);
    assert.equal(w.referralEarnings, 50);
    assert.equal(w.transactions.length, 7);
});

await check('a Quick cashback reversal is taken once however often it is asked', async () => {
    const orderId = new mongoose.Types.ObjectId();
    await db.collection('qc_orders').insertOne({ _id: orderId, order_id: 'QC-CB', userId: qcId });
    await CustomerWallet.updateOne({ userId: platformId }, { $push: { transactions: { $each: [{ type: 'addition', amount: 40, metadata: { source: 'cashback', orderId: String(orderId) } }], $position: 0 } } });
    const before = (await wallet()).balance;
    const runs = await Promise.all([1, 2, 3].map(() => qcCashback.reverseOrderCashback(orderId, { refundedAmount: 100, orderTotal: 100, key: 'r1' })));
    assert.equal(runs.filter((r) => r.reversed > 0).length, 1);
    assert.equal((await wallet()).balance, before - 40);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Quick wallet move checks passed');
process.exit(0);
