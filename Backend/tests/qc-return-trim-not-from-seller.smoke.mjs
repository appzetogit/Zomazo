/**
 * A return refund trimmed because the order's fees were already refunded takes
 * the trim from the platform, never from the seller's debit for goods it failed
 * to supply. Deterministic companion to qc-return-payout, whose concurrent case
 * hit this only when the trimmed refund reached the ledger first.
 *
 * Run: node tests/qc-return-trim-not-from-seller.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('qc_return_trim'));

const { FoodTransaction } = await import('../src/modules/quickCommerce/modules/food/orders/models/foodTransaction.model.js');
const { recordReturnRefund } = await import('../src/modules/quickCommerce/modules/food/orders/services/foodTransaction.service.js');

const orderId = new mongoose.Types.ObjectId();
// Rs 268.40 paid: Rs 200 of goods (two items, Rs 100 each) to the seller,
// Rs 28.40 GST, Rs 40 of fees to the platform.
await FoodTransaction.collection.insertOne({
    orderId, userId: new mongoose.Types.ObjectId(), restaurantId: new mongoose.Types.ObjectId(),
    paymentMethod: 'wallet', status: 'captured', history: [],
    amounts: { totalCustomerPaid: 268.4, restaurantShare: 200, restaurantCommission: 0, riderShare: 0, platformNetProfit: 40, taxAmount: 28.4, refundedAmount: 0 },
});

// The second return, trimmed to what the order had left (Rs 105 of its Rs
// 110.40 goods + GST), happens to be booked first; then the first, in full.
await recordReturnRefund(orderId, { amount: 105, tax: 10.4, goods: 100, subtotal: 200, sellerFault: true, returnCode: 'B' });
await recordReturnRefund(orderId, { amount: 163.4, tax: 18, goods: 100, subtotal: 200, sellerFault: true, returnCode: 'A' });

const a = (await FoodTransaction.findOne({ orderId }).lean()).amounts;
const r2 = (n) => Math.round(n * 100) / 100;
assert.equal(a.restaurantShare, 0, `the seller still holds ${a.restaurantShare} for goods it never supplied`);
assert.equal(a.sellerReturnDebit, 200);
assert.equal(a.taxAmount, 0);
assert.equal(a.refundedAmount, 268.4);
assert.equal(r2(a.restaurantShare + a.riderShare + a.platformNetProfit + a.taxAmount), r2(a.totalCustomerPaid - a.refundedAmount), 'every rupee kept is credited once');

await mongoose.disconnect();
await mongo.stop();
console.log('All return-trim checks passed');
process.exit(0);
