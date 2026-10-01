/**
 * Quick-commerce admin refunds are capped and claimed once
 * (orders/services/order.service.js processRefundAdmin).
 *
 * Run: node tests/qc-admin-refund-cap.smoke.mjs
 *
 * Before: the only check was "the payment is not already marked refunded", and the
 * amount was not checked at all -- an admin could refund Rs 5000 on a Rs 300 order,
 * and two clicks paid twice. Now every admin refund reserves against the same
 * counter returns use (order.returnRefundedPaise), all or nothing.
 *
 * Razorpay is never called: the gateway path is only exercised with no keys
 * configured, which must fail and give the claim back.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

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
const thrownBy = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_admin_refund' });

const BASE = '../src/modules/quickCommerce/modules/food';
// The order ledger model first; see qc-return-payout.smoke.mjs.
await import(`${BASE}/orders/models/foodTransaction.model.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { FoodUserWallet } = await import(`${BASE}/user/models/userWallet.model.js`);
const { processRefundAdmin } = await import(`${BASE}/orders/services/order.service.js`);

const oid = () => new mongoose.Types.ObjectId();
const adminId = String(oid());

const makeOrder = async ({ method = 'wallet', total = 300, extra = {}, payment = {} } = {}) => {
  const _id = oid();
  const userId = oid();
  await FoodOrder.collection.insertOne({
    _id, orderId: `QC-${String(_id).slice(-5)}`, userId, orderStatus: 'delivered',
    payment: { method, status: 'paid', ...payment }, pricing: { total }, createdAt: new Date(), ...extra,
  });
  return { _id, userId };
};
const walletOf = async (userId) => Number((await FoodUserWallet.findOne({ userId }).lean())?.balance || 0);

console.log('\nquick admin refunds');

await check('partial refunds add up to the amount paid and no further', async () => {
  const { _id, userId } = await makeOrder();
  await processRefundAdmin(String(_id), 100, adminId);
  let o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.status, 'paid', 'a partial refund leaves the order paid');
  assert.equal(o.returnRefundedPaise, 10000);
  const over = await thrownBy(() => processRefundAdmin(String(_id), 250, adminId));
  assert.equal(over?.statusCode, 400);
  assert.match(over.message, /200\.00/);
  await processRefundAdmin(String(_id), undefined, adminId); // the rest
  o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.status, 'refunded');
  assert.equal(o.payment.refund.amount, 300);
  assert.equal(await walletOf(userId), 300);
  const again = await thrownBy(() => processRefundAdmin(String(_id), 1, adminId));
  assert.equal(again?.statusCode, 400);
});

await check('an amount above the order total is refused outright', async () => {
  const { _id, userId } = await makeOrder();
  const err = await thrownBy(() => processRefundAdmin(String(_id), 5000, adminId));
  assert.equal(err?.statusCode, 400);
  assert.equal(await walletOf(userId), 0);
});

await check('money already refunded through a return counts against the cap', async () => {
  const { _id } = await makeOrder({ extra: { returnRefundedPaise: 25000 } });
  const err = await thrownBy(() => processRefundAdmin(String(_id), 60, adminId));
  assert.equal(err?.statusCode, 400);
  await processRefundAdmin(String(_id), 50, adminId);
  const o = await FoodOrder.findById(_id).lean();
  assert.equal(o.returnRefundedPaise, 30000);
});

await check('a cancellation refund recorded before the counter existed counts too', async () => {
  const { _id } = await makeOrder({ payment: { status: 'refunded', refund: { status: 'processed', amount: 300 } } });
  const err = await thrownBy(() => processRefundAdmin(String(_id), 10, adminId));
  assert.equal(err?.statusCode, 400);
});

await check('two full refunds at once: exactly one pays', async () => {
  const { _id, userId } = await makeOrder({ total: 200 });
  const results = await Promise.allSettled([
    processRefundAdmin(String(_id), undefined, adminId),
    processRefundAdmin(String(_id), undefined, adminId),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await walletOf(userId), 200);
  assert.equal((await FoodOrder.findById(_id).lean()).returnRefundedPaise, 20000);
});

await check('a failed gateway refund gives the headroom back', async () => {
  const { _id } = await makeOrder({ method: 'razorpay', payment: { razorpay: { paymentId: 'pay_x' } } });
  const err = await thrownBy(() => processRefundAdmin(String(_id), 50, adminId));
  assert.equal(err?.statusCode, 424, err?.message);
  const o = await FoodOrder.findById(_id).lean();
  assert.equal(o.returnRefundedPaise, 0);
  assert.equal(o.payment.status, 'paid');
});

await check('cash orders are still refused', async () => {
  const { _id } = await makeOrder({ method: 'cash' });
  const err = await thrownBy(() => processRefundAdmin(String(_id), 10, adminId));
  assert.equal(err?.statusCode, 400);
});

await check('each admin refund is kept on payment.refund.history', async () => {
  const { _id } = await makeOrder();
  await processRefundAdmin(String(_id), 40, adminId, 'damaged pack');
  await processRefundAdmin(String(_id), 60, adminId, 'late delivery');
  const o = await FoodOrder.findById(_id).lean();
  assert.deepEqual(o.payment.refund.history.map((h) => [h.amount, h.reason, h.byAdminId]),
    [[40, 'damaged pack', adminId], [60, 'late delivery', adminId]]);
});

await check('a stale claim whose payout happened is recorded, not paid again', async () => {
  const { _id, userId } = await makeOrder({ extra: { returnRefundedPaise: 10000 } });
  const key = 'rf_test_qc';
  await FoodOrder.collection.updateOne({ _id }, { $set: {
    'payment.refund': { status: 'pending', claim: { key, at: new Date(Date.now() - 11 * 60000), amountPaise: 10000, prevStatus: 'none', method: 'wallet', reason: 'crashed' } },
  } });
  await FoodUserWallet.collection.insertOne({ userId, balance: 100, transactions: [{ type: 'refund', amount: 100, metadata: { claimKey: key } }] });
  const fresh = await thrownBy(() => processRefundAdmin(String(_id), 250, adminId, 'too much'));
  assert.equal(fresh?.statusCode, 400, 'the crashed 100 still counts against the cap');
  await processRefundAdmin(String(_id), 200, adminId, 'the rest');
  const o = await FoodOrder.findById(_id).lean();
  assert.deepEqual(o.payment.refund.history.map((h) => h.amount), [100, 200]);
  assert.equal(o.returnRefundedPaise, 30000);
  assert.equal(await walletOf(userId), 300);
});

await check('a stale claim that never paid is released', async () => {
  const { _id, userId } = await makeOrder();
  await FoodOrder.collection.updateOne({ _id }, { $set: {
    returnRefundedPaise: 10000,
    'payment.refund': { status: 'pending', claim: { key: 'rf_test_qc2', at: new Date(Date.now() - 11 * 60000), amountPaise: 10000, prevStatus: 'none' } },
  } });
  await processRefundAdmin(String(_id), undefined, adminId, 'all of it');
  assert.equal(await walletOf(userId), 300);
  assert.equal((await FoodOrder.findById(_id).lean()).returnRefundedPaise, 30000);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
