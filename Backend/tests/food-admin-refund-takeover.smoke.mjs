/**
 * Food admin refund: taking over a crashed claim whose Razorpay refund DID go
 * through, and a cancellation racing an admin refund
 * (core/orders/adminRefundClaim.js, order.service.js adminRefundOrder /
 * processOrderRefundOnce).
 *
 * Run: node tests/food-admin-refund-takeover.smoke.mjs
 *
 * Razorpay is stubbed at axios.defaults.adapter (the SDK builds its client from
 * axios per call): the refund list answers with a refund carrying the crashed
 * claim's key, and every refund POST is counted. Nothing leaves the machine.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
process.env.RAZORPAY_KEY_ID = 'rzp_test_takeover_stub';
process.env.RAZORPAY_KEY_SECRET = 'stub_secret_never_sent_anywhere';

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

// The fake gateway. The Razorpay SDK is CommonJS and requires its own axios, so
// the stub goes on THAT axios -- the ESM import is a separate module instance and
// its defaults would never reach the SDK.
const requireFromSdk = createRequire(createRequire(import.meta.url).resolve('razorpay'));
const axios = requireFromSdk('axios').default || requireFromSdk('axios');
const gateway = { refundsByPayment: {}, posts: [], requests: [] };
axios.defaults.adapter = async (config) => {
  const url = `${config.baseURL || ''}${config.url || ''}`;
  const method = String(config.method || 'get').toUpperCase();
  gateway.requests.push(`${method} ${url}`);
  const reply = (data, status = 200) => ({ data, status, statusText: 'OK', headers: {}, config, request: {} });
  let m = url.match(/payments\/([^/?]+)\/refunds/);
  if (method === 'GET' && m) return reply({ entity: 'collection', count: 0, items: gateway.refundsByPayment[m[1]] || [] });
  m = url.match(/payments\/([^/?]+)\/refund$/);
  if (method === 'POST' && m) {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    gateway.posts.push({ paymentId: m[1], body });
    return reply({ id: `rfnd_new_${gateway.posts.length}`, amount: body.amount, status: 'processed', notes: body.notes });
  }
  throw new Error(`unexpected gateway call ${method} ${url}`);
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('food_refund_takeover');
await mongoose.connect(process.env.MONGO_URI);

const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const svc = await import('../src/modules/food/orders/services/order.service.js');

const oid = () => new mongoose.Types.ObjectId();
const adminId = String(oid());

console.log('\nfood admin refund takeover and cancellation race');

await check('stale claim already refunded at Razorpay: recorded, never refunded twice', async () => {
  const _id = oid();
  const key = 'rf_crashed_claim_1';
  await FoodOrder.collection.insertOne({
    _id, order_id: 'FOD-TAKE1', userId: oid(), orderStatus: 'delivered', pricing: { total: 300 }, createdAt: new Date(),
    payment: {
      method: 'razorpay', status: 'paid', razorpay: { paymentId: 'pay_real_1' },
      refund: { status: 'pending', refundedPaise: 10000, claim: { key, at: new Date(Date.now() - 11 * 60000), amountPaise: 10000, prevStatus: 'none', method: 'razorpay', reason: 'crashed' } },
    },
  });
  gateway.refundsByPayment.pay_real_1 = [{ id: 'rfnd_old', amount: 10000, receipt: key, notes: { refund_key: key } }];

  // Too much for what is left once the crashed 100 is counted: the takeover runs,
  // records the old refund, and refuses -- with no refund POSTed at all.
  const err = await thrownBy(() => svc.adminRefundOrder(String(_id), { amount: 250, reason: 'more than left', adminId }));
  assert.equal(err?.statusCode, 400, err?.message);
  assert.equal(gateway.posts.length, 0, 'no refund call');
  assert.ok(gateway.requests.some((r) => r.startsWith('GET') && r.includes('pay_real_1/refunds')), 'the gateway was asked first');
  let o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.refund.status, 'processed');
  assert.equal(o.payment.refund.claim, undefined);
  assert.deepEqual(o.payment.refund.history.map((h) => [h.amount, h.refundId, h.claimKey]), [[100, 'rfnd_old', key]]);
  assert.equal(o.payment.refund.refundedPaise, 10000);

  // And the next refund pays only its own amount, tagged with its own key.
  await svc.adminRefundOrder(String(_id), { amount: 50, reason: 'goodwill', adminId });
  assert.equal(gateway.posts.length, 1);
  assert.equal(gateway.posts[0].body.amount, 5000);
  assert.match(gateway.posts[0].body.notes.refund_key, /^rf_/);
  assert.notEqual(gateway.posts[0].body.notes.refund_key, key);
  o = await FoodOrder.findById(_id).lean();
  assert.deepEqual(o.payment.refund.history.map((h) => h.amount), [100, 50]);
  assert.equal(o.payment.refund.refundedPaise, 15000);
});

await check('cancellation refund while an admin refund is being paid: skipped', async () => {
  const _id = oid();
  await FoodOrder.collection.insertOne({
    _id, order_id: 'FOD-RACE1', userId: oid(), orderStatus: 'cancelled_by_restaurant', pricing: { total: 300 }, createdAt: new Date(),
    payment: {
      method: 'razorpay', status: 'paid', razorpay: { paymentId: 'pay_real_2' },
      refund: { status: 'pending', refundedPaise: 20000, claim: { key: 'rf_live', at: new Date(), amountPaise: 20000, prevStatus: 'none' } },
    },
  });
  const posts = gateway.posts.length;
  const doc = await FoodOrder.findById(_id);
  await svc.processOrderRefundOnce(doc, doc.userId);
  assert.equal(gateway.posts.length, posts, 'no cancellation refund on top of the admin one');
  const o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.refund.status, 'pending');
  assert.equal(o.payment.refund.claim.key, 'rf_live');
});

await check('after an admin partial refund, a cancellation refunds nothing more', async () => {
  const _id = oid();
  await FoodOrder.collection.insertOne({
    _id, order_id: 'FOD-RACE2', userId: oid(), orderStatus: 'delivered', pricing: { total: 300 }, createdAt: new Date(),
    payment: { method: 'razorpay', status: 'paid', razorpay: { paymentId: 'pay_real_3' } },
  });
  await svc.adminRefundOrder(String(_id), { amount: 120, reason: 'partial', adminId });
  const posts = gateway.posts.length;
  const doc = await FoodOrder.findById(_id);
  await svc.processOrderRefundOnce(doc, doc.userId);
  assert.equal(gateway.posts.length, posts);
  const o = await FoodOrder.findById(_id).lean();
  assert.equal(o.payment.refund.refundedPaise, 12000, 'total out stays within what was paid');
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
