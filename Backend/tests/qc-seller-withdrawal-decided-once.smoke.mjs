/**
 * Quick: a seller withdrawal is decided once. An approved (paid) request
 * cannot be flipped to rejected, which would hand the money back to the
 * seller's balance.
 *
 * Run: node tests/qc-seller-withdrawal-decided-once.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_seller_withdrawal');
await mongoose.connect(mongo.getUri('qc_seller_withdrawal'));

const { updateWithdrawalStatus } = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
const { FoodRestaurantWithdrawal } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js');

const seed = async () => {
    const _id = new mongoose.Types.ObjectId();
    await FoodRestaurantWithdrawal.collection.insertOne({
        _id, restaurantId: new mongoose.Types.ObjectId(), amount: 500, status: 'pending', createdAt: new Date(),
    });
    return String(_id);
};

await check('pending -> approved works, and "processed" means approved', async () => {
    const id = await seed();
    const out = await updateWithdrawalStatus(id, { status: 'processed', transactionId: 'UTR1' });
    assert.equal(out.status, 'approved');
    assert.equal(out.transactionId, 'UTR1');
});

await check('an approved request cannot be flipped to rejected', async () => {
    const id = await seed();
    await updateWithdrawalStatus(id, { status: 'approved' });
    await assert.rejects(() => updateWithdrawalStatus(id, { status: 'rejected' }), /Cannot change a approved/);
    assert.equal((await FoodRestaurantWithdrawal.findById(id).lean()).status, 'approved');
});

await check('re-saving the same status only edits the notes', async () => {
    const id = await seed();
    await updateWithdrawalStatus(id, { status: 'approved' });
    const out = await updateWithdrawalStatus(id, { status: 'approved', adminNote: 'paid by NEFT' });
    assert.equal(out.status, 'approved');
    assert.equal(out.adminNote, 'paid by NEFT');
});

await check('an unknown status is refused', async () => {
    const id = await seed();
    await assert.rejects(() => updateWithdrawalStatus(id, { status: 'paid-twice' }), /Invalid withdrawal status/);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
