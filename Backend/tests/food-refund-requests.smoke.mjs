/**
 * Food "New Refund Requests": the queue of cancelled paid orders whose money has
 * not gone back, and the admin's two answers to each (order.service.js
 * listRefundRequests / adminRefundOrder / rejectRefundRequest).
 *
 * Run: node tests/food-refund-requests.smoke.mjs
 *
 * The admin page called adminAPI.getRefundRequests, which did not exist, so the
 * page never loaded.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('food_refund_requests');
await mongoose.connect(process.env.MONGO_URI);

const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const svc = await import('../src/modules/food/orders/services/order.service.js');

const oid = () => new mongoose.Types.ObjectId();
const adminId = String(oid());
const make = async ({ orderStatus = 'cancelled_by_restaurant', status = 'paid', method = 'wallet', refund } = {}) => {
  const _id = oid();
  await FoodOrder.collection.insertOne({
    _id, order_id: `FOD-${String(_id).slice(-6)}`, userId: oid(), restaurantId: oid(), orderStatus,
    payment: { method, status, ...(refund ? { refund } : {}) }, pricing: { total: 200 },
    statusHistory: [{ at: new Date(), byRole: 'RESTAURANT', from: 'confirmed', to: orderStatus, note: 'out of stock' }],
    createdAt: new Date(), updatedAt: new Date(),
  });
  return String(_id);
};
const ids = async () => (await svc.listRefundRequests({})).orders.map((o) => o.id);

console.log('\nfood refund requests');

const open = await make();
const failedRefund = await make({ method: 'razorpay', refund: { status: 'failed', amount: 200 } });
const refunded = await make({ status: 'refunded', refund: { status: 'processed', amount: 200 } });
const delivered = await make({ orderStatus: 'delivered' });
const cashNeverCollected = await make({ method: 'cash', status: 'cod_pending' });

await check('lists cancelled paid orders not yet refunded, in the shape the page reads', async () => {
  const list = await svc.listRefundRequests({});
  const got = list.orders.map((o) => o.id).sort();
  assert.deepEqual(got, [open, failedRefund].sort());
  const row = list.orders.find((o) => o.id === open);
  assert.equal(row.totalAmount, 200);
  assert.equal(row.cancellationReason, 'out of stock');
  assert.equal(list.pagination.total, 2);
  for (const id of [refunded, delivered, cashNeverCollected]) assert.ok(!got.includes(id));
});

await check('approve: refunded through adminRefundOrder and gone from the queue', async () => {
  await svc.adminRefundOrder(open, { reason: 'restaurant cancelled', adminId });
  assert.ok(!(await ids()).includes(open));
});

await check('reject: needs a reason, is recorded, and leaves the queue', async () => {
  const noReason = await thrownBy(() => svc.rejectRefundRequest(failedRefund, { adminId }));
  assert.equal(noReason?.statusCode, 400);
  await svc.rejectRefundRequest(failedRefund, { reason: 'customer used the food', adminId });
  const o = await FoodOrder.findById(failedRefund).lean();
  assert.equal(o.payment.refund.decision.status, 'rejected');
  assert.equal(o.payment.refund.decision.reason, 'customer used the food');
  assert.equal(o.payment.status, 'paid');
  assert.ok(!(await ids()).includes(failedRefund));
});

await check('cannot reject an order already refunded, or one being refunded', async () => {
  assert.equal((await thrownBy(() => svc.rejectRefundRequest(refunded, { reason: 'too late', adminId })))?.statusCode, 400);
  const inFlight = await make({ refund: { status: 'pending', claim: { key: 'k', at: new Date() } } });
  assert.equal((await thrownBy(() => svc.rejectRefundRequest(inFlight, { reason: 'racing', adminId })))?.statusCode, 400);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
