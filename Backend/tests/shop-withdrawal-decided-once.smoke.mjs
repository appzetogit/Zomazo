/**
 * A Shop withdrawal is decided once, and pays once.
 *
 * Run: node tests/shop-withdrawal-decided-once.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('shop_withdrawal_once');
await mongoose.connect(mongo.getUri('shop_withdrawal_once'));

const admin = await import('../src/modules/ecommerce/modules/commerce/admin/services/admin.service.js');
const { DeliveryWithdrawal } = await import('../src/modules/ecommerce/modules/commerce/delivery/models/deliveryWithdrawal.model.js');
const { DeliveryWallet } = await import('../src/modules/ecommerce/modules/commerce/delivery/models/deliveryWallet.model.js');
const { SellerWithdrawal } = await import('../src/modules/ecommerce/modules/commerce/seller/models/sellerWithdrawal.model.js');

const oid = () => new mongoose.Types.ObjectId();

await check('two admins approving one rider withdrawal together debit the wallet once', async () => {
    const rider = oid();
    await DeliveryWallet.collection.insertOne({ deliveryPartnerId: rider, balance: 1000, lockedAmount: 400, totalSettled: 0 });
    const w = await DeliveryWithdrawal.collection.insertOne({ deliveryPartnerId: rider, amount: 400, status: 'pending', paymentMethod: 'bank_transfer' });
    const id = String(w.insertedId);
    const results = await Promise.allSettled([
        admin.updateDeliveryWithdrawalStatus(id, { status: 'approved' }),
        admin.updateDeliveryWithdrawalStatus(id, { status: 'approved' }),
    ]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    const wallet = await DeliveryWallet.collection.findOne({ deliveryPartnerId: rider });
    assert.equal(wallet.balance, 600);
    assert.equal(wallet.totalSettled, 400);
});

await check('a paid rider withdrawal cannot be rejected afterwards', async () => {
    const rider = oid();
    await DeliveryWallet.collection.insertOne({ deliveryPartnerId: rider, balance: 1000, lockedAmount: 0 });
    const w = await DeliveryWithdrawal.collection.insertOne({ deliveryPartnerId: rider, amount: 300, status: 'pending', paymentMethod: 'bank_transfer' });
    await admin.updateDeliveryWithdrawalStatus(String(w.insertedId), { status: 'approved' });
    await assert.rejects(admin.updateDeliveryWithdrawalStatus(String(w.insertedId), { status: 'rejected' }), /Cannot change/);
});

await check('an approval the balance cannot cover leaves the request pending', async () => {
    const rider = oid();
    await DeliveryWallet.collection.insertOne({ deliveryPartnerId: rider, balance: 100, lockedAmount: 0 });
    const w = await DeliveryWithdrawal.collection.insertOne({ deliveryPartnerId: rider, amount: 300, status: 'pending', paymentMethod: 'bank_transfer' });
    await assert.rejects(admin.updateDeliveryWithdrawalStatus(String(w.insertedId), { status: 'approved' }), /lower than/);
    assert.equal((await DeliveryWithdrawal.collection.findOne({ _id: w.insertedId })).status, 'pending');
});

await check('a paid seller withdrawal cannot be flipped to rejected or back to pending', async () => {
    const w = await SellerWithdrawal.collection.insertOne({ sellerId: oid(), amount: 500, status: 'pending' });
    const id = String(w.insertedId);
    await admin.updateWithdrawalStatus(id, { status: 'approved', transactionId: 'UTR1' });
    await assert.rejects(admin.updateWithdrawalStatus(id, { status: 'rejected' }), /Cannot change/);
    await assert.rejects(admin.updateWithdrawalStatus(id, { status: 'pending' }), /Cannot change/);
    const again = await admin.updateWithdrawalStatus(id, { status: 'approved', transactionId: 'UTR2' });
    assert.equal(again.transactionId, 'UTR2', 'the same decision may update its notes');
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop withdrawal checks passed');
process.exit(0);
