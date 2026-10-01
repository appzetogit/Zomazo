/**
 * Shop admin refunds are capped, claimed once, kept, and recover from a crash
 * (modules/ecommerce/.../orders/services/order.service.js processRefundAdmin).
 *
 * Run: node tests/shop-admin-refund-cap.smoke.mjs
 *
 * Before: the amount was checked against the order total only, so two admin
 * refunds -- or one after a return -- could pay out more than was paid, and two
 * clicks paid twice. Now the cap is paid minus everything refunded (returns and
 * cancellations add up on payment.refund.amount), the claim is atomic, each
 * refund is on order.adminRefund.history, and a claim a crash left behind is
 * settled after ten minutes by looking its payout up first.
 *
 * Razorpay is never called: the gateway path runs only with no keys, and fails.
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
await mongoose.connect(mongo.getUri(), { dbName: 'shop_admin_refund' });

const BASE = '../src/modules/ecommerce/modules/commerce';
const { Order } = await import(`${BASE}/orders/models/order.model.js`);
const { UserWallet } = await import(`${BASE}/user/models/userWallet.model.js`);
const { processRefundAdmin } = await import(`${BASE}/orders/services/order.service.js`);

const oid = () => new mongoose.Types.ObjectId();
const adminId = String(oid());

const makeOrder = async ({ method = 'wallet', total = 300, payment = {}, extra = {} } = {}) => {
  const _id = oid();
  const userId = oid();
  await Order.collection.insertOne({
    _id, order_id: `SHP-${String(_id).slice(-6)}`, userId, orderStatus: 'delivered',
    payment: { method, status: 'paid', ...payment }, pricing: { total }, createdAt: new Date(), ...extra,
  });
  return { _id, userId };
};
const walletOf = async (userId) => Number((await UserWallet.findOne({ userId }).lean())?.balance || 0);

console.log('\nshop admin refunds');

await check('partial refunds add up to what was paid, each kept on the order', async () => {
  const { _id, userId } = await makeOrder();
  await processRefundAdmin(String(_id), 100, adminId, 'missing item');
  let o = await Order.findById(_id).lean();
  assert.equal(o.payment.status, 'paid');
  assert.equal(o.payment.refund.amount, 100);
  const over = await thrownBy(() => processRefundAdmin(String(_id), 250, adminId, 'too much'));
  assert.equal(over?.statusCode, 400);
  await processRefundAdmin(String(_id), undefined, adminId, 'the rest');
  o = await Order.findById(_id).lean();
  assert.equal(o.payment.status, 'refunded');
  assert.equal(o.payment.refund.amount, 300);
  assert.deepEqual(o.adminRefund.history.map((h) => [h.amount, h.reason]), [[100, 'missing item'], [200, 'the rest']]);
  assert.equal(await walletOf(userId), 300);
  assert.equal((await thrownBy(() => processRefundAdmin(String(_id), 1, adminId, 'again')))?.statusCode, 400);
});

await check('money refunded by a return counts against the cap', async () => {
  const { _id } = await makeOrder({ payment: { refund: { status: 'processed', amount: 250 } } });
  assert.equal((await thrownBy(() => processRefundAdmin(String(_id), 60, adminId, 'over')))?.statusCode, 400);
  await processRefundAdmin(String(_id), 50, adminId, 'the rest');
  const o = await Order.findById(_id).lean();
  assert.equal(o.payment.refund.amount, 300);
  assert.equal(o.payment.status, 'refunded');
});

await check('an order refunded in full on cancellation has nothing left', async () => {
  const { _id } = await makeOrder({ payment: { status: 'refunded', refund: { status: 'processed', amount: 300 } } });
  assert.equal((await thrownBy(() => processRefundAdmin(String(_id), 1, adminId, 'again')))?.statusCode, 400);
});

await check('two full refunds at once: exactly one pays', async () => {
  const { _id, userId } = await makeOrder({ total: 200 });
  const results = await Promise.allSettled([
    processRefundAdmin(String(_id), undefined, adminId, 'click one'),
    processRefundAdmin(String(_id), undefined, adminId, 'click two'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await walletOf(userId), 200);
});

await check('a failed gateway refund gives the claim back', async () => {
  const { _id } = await makeOrder({ method: 'razorpay', payment: { razorpay: { paymentId: 'pay_x' } } });
  assert.equal((await thrownBy(() => processRefundAdmin(String(_id), 50, adminId, 'try it')))?.statusCode, 424);
  const o = await Order.findById(_id).lean();
  assert.equal(o.adminRefund?.refundedPaise ?? 0, 0);
  assert.equal(o.adminRefund?.status ?? 'none', 'none');
});

const stale = async ({ paidOut, minutesAgo = 11 }) => {
  const { _id, userId } = await makeOrder();
  const key = `rf_shop_${String(_id).slice(-6)}`;
  await Order.collection.updateOne({ _id }, { $set: { adminRefund: {
    status: 'pending', refundedPaise: 10000,
    claim: { key, at: new Date(Date.now() - minutesAgo * 60000), amountPaise: 10000, prevStatus: 'none', method: 'wallet', reason: 'crashed' },
  } } });
  if (paidOut) await UserWallet.collection.insertOne({ userId, balance: 100, transactions: [{ type: 'refund', amount: 100, metadata: { claimKey: key } }] });
  return { _id, userId };
};

await check('a fresh pending claim blocks; a stale one is taken over', async () => {
  const fresh = await stale({ paidOut: false, minutesAgo: 1 });
  assert.equal((await thrownBy(() => processRefundAdmin(String(fresh._id), 10, adminId, 'second')))?.statusCode, 409);
});

await check('stale claim that paid: recorded once, never paid again', async () => {
  const { _id, userId } = await stale({ paidOut: true });
  await processRefundAdmin(String(_id), undefined, adminId, 'the rest');
  const o = await Order.findById(_id).lean();
  assert.deepEqual(o.adminRefund.history.map((h) => h.amount), [100, 200]);
  assert.equal(o.payment.refund.amount, 300);
  assert.equal(await walletOf(userId), 300);
});

await check('stale claim that never paid: released', async () => {
  const { _id, userId } = await stale({ paidOut: false });
  await processRefundAdmin(String(_id), undefined, adminId, 'all of it');
  assert.equal(await walletOf(userId), 300);
  assert.equal((await Order.findById(_id).lean()).adminRefund.refundedPaise, 30000);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
