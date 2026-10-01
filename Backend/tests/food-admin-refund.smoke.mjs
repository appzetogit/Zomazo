/**
 * Food admin refunds (orders/services/order.service.js adminRefundOrder).
 *
 * Run: node tests/food-admin-refund.smoke.mjs
 *
 * What this guards:
 *   - full and partial refunds, never more in total than was paid;
 *   - two refunds started together cannot both spend the same headroom;
 *   - money goes back the way it came: Razorpay for online, wallet for wallet,
 *     wallet (with a clear reason) for cash;
 *   - an order already refunded on cancellation has nothing left to refund;
 *   - a payout that fails gives the claim back and records nothing;
 *   - every refund is on the order's history and the money ledger.
 *
 * Razorpay is never called: payment ids starting mock_ take the helper's
 * non-production mock, and a real-looking id with no keys configured fails.
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
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('food_admin_refund');
await mongoose.connect(process.env.MONGO_URI);

const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { adminRefundOrder } = await import('../src/modules/food/orders/services/order.service.js');

const adminId = String(new mongoose.Types.ObjectId());
const oid = () => new mongoose.Types.ObjectId();

const makeOrder = async ({ method, status = 'paid', total = 300, paymentId, refund } = {}) => {
  const _id = oid();
  const userId = oid();
  await FoodOrder.collection.insertOne({
    _id, order_id: `FOD-${String(_id).slice(-5)}`, userId, orderStatus: 'delivered',
    payment: { method, status, ...(paymentId ? { razorpay: { paymentId } } : {}), ...(refund ? { refund } : {}) },
    pricing: { total }, createdAt: new Date(),
  });
  await FoodTransaction.collection.insertOne({
    orderId: _id, userId, paymentMethod: method, status: 'captured', history: [],
    amounts: { totalCustomerPaid: total },
  });
  return { _id, userId };
};
const walletOf = async (userId) => Number((await CustomerWallet.findOne({ userId }).lean())?.balance || 0);

console.log('\nfood admin refunds');

await check('online order: partial then the rest, to Razorpay, recorded twice', async () => {
  const { _id } = await makeOrder({ method: 'razorpay', paymentId: 'mock_pay_1' });
  const first = await adminRefundOrder(String(_id), { amount: 100, reason: 'cold food', adminId });
  assert.match(first.refund.refundId, /^mock_ref_/);
  assert.equal(first.refund.refundableLeft, 200);
  let o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.status, 'paid', 'partial refund leaves the order paid');
  assert.equal(o.payment.refund.status, 'processed');

  const second = await adminRefundOrder(String(_id), { reason: 'refund the rest', adminId });
  assert.equal(second.refund.amount, 200, 'no amount = everything still refundable');
  o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.status, 'refunded');
  assert.equal(o.payment.refund.amount, 300);
  assert.equal(o.payment.refund.history.length, 2);
  assert.equal(o.payment.refund.history[0].byAdminId, adminId);
  assert.equal(o.payment.refund.history[0].reason, 'cold food');

  const tx = await FoodTransaction.findOne({ orderId: _id }).lean();
  assert.equal(tx.status, 'refunded');
  assert.deepEqual(tx.history.map((h) => h.amount), [100, 200]);

  const more = await thrownBy(() => adminRefundOrder(String(_id), { amount: 1, reason: 'again', adminId }));
  assert.equal(more?.statusCode, 400);
  assert.match(more.message, /already been refunded/);
});

await check('amount is capped at what is left, and must be positive', async () => {
  const { _id } = await makeOrder({ method: 'wallet' });
  await adminRefundOrder(String(_id), { amount: 250, reason: 'missing items', adminId });
  const over = await thrownBy(() => adminRefundOrder(String(_id), { amount: 50.01, reason: 'more', adminId }));
  assert.equal(over?.statusCode, 400);
  assert.match(over.message, /50\.00/);
  const zero = await thrownBy(() => adminRefundOrder(String(_id), { amount: 0, reason: 'zero', adminId }));
  assert.equal(zero?.statusCode, 400);
  const noReason = await thrownBy(() => adminRefundOrder(String(_id), { amount: 10, adminId }));
  assert.equal(noReason?.statusCode, 400);
});

await check('wallet order refunds to the wallet', async () => {
  const { _id, userId } = await makeOrder({ method: 'wallet', total: 120 });
  await adminRefundOrder(String(_id), { amount: 120, reason: 'late', adminId });
  assert.equal(await walletOf(userId), 120);
});

await check('cash order (collected) refunds to the wallet, and says so', async () => {
  const { _id, userId } = await makeOrder({ method: 'cash', total: 80 });
  const r = await adminRefundOrder(String(_id), { amount: 30, reason: 'wrong item', adminId });
  assert.equal(r.refund.method, 'wallet');
  assert.equal(await walletOf(userId), 30);
  const w = await CustomerWallet.findOne({ userId }).lean();
  assert.match(w.transactions[0].description, /cash/);
});

await check('cash not yet collected: nothing to refund', async () => {
  const { _id } = await makeOrder({ method: 'cash', status: 'cod_pending' });
  const err = await thrownBy(() => adminRefundOrder(String(_id), { amount: 10, reason: 'test', adminId }));
  assert.equal(err?.statusCode, 400);
});

await check('order already refunded on cancellation has no headroom', async () => {
  const { _id } = await makeOrder({
    method: 'razorpay', status: 'refunded', paymentId: 'mock_pay_2',
    refund: { status: 'processed', amount: 300, refundId: 'rfnd_x' },
  });
  const err = await thrownBy(() => adminRefundOrder(String(_id), { amount: 10, reason: 'again', adminId }));
  assert.equal(err?.statusCode, 400);
});

await check('two full refunds at once: exactly one pays', async () => {
  const { _id, userId } = await makeOrder({ method: 'wallet', total: 200 });
  const results = await Promise.allSettled([
    adminRefundOrder(String(_id), { reason: 'click one', adminId }),
    adminRefundOrder(String(_id), { reason: 'click two', adminId }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert.ok([400, 409].includes(rejected.reason.statusCode), rejected.reason.message);
  assert.equal(await walletOf(userId), 200);
  const o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.refund.history.length, 1);
});

await check('a failed gateway refund gives the claim back and records nothing', async () => {
  const { _id } = await makeOrder({ method: 'razorpay', paymentId: 'pay_real_1' });
  const err = await thrownBy(() => adminRefundOrder(String(_id), { amount: 50, reason: 'try it', adminId }));
  assert.equal(err?.statusCode, 424, err?.message);
  const o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.status, 'paid');
  assert.equal(o.payment.refund?.status ?? 'none', 'none');
  assert.equal(o.payment.refund?.refundedPaise ?? 0, 0);
  assert.equal(o.payment.refund?.history?.length ?? 0, 0);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
