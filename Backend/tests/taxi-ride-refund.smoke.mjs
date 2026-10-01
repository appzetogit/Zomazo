/**
 * Taxi admin ride refunds (modules/taxi/services/rideRefund.service.js).
 *
 * Run: node tests/taxi-ride-refund.smoke.mjs
 *
 * What this guards:
 *   - only a completed or cancelled ride that was paid can be refunded;
 *   - full and partial refunds, never more in total than was paid;
 *   - two refunds started together cannot both pay;
 *   - online -> Razorpay, wallet -> wallet, cash -> wallet (saying so);
 *   - a failed gateway refund gives the claim back and records nothing;
 *   - each refund is kept on the ride.
 *
 * Razorpay is never called: a mock_ payment id takes the non-production mock,
 * and a real-looking id with no keys configured fails.
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
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('taxi_ride_refund');
await mongoose.connect(process.env.MONGO_URI);

const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { refundRideByAdmin } = await import('../src/modules/taxi/services/rideRefund.service.js');

const oid = () => new mongoose.Types.ObjectId();
const adminId = String(oid());

const makeRide = async ({ status = 'completed', paymentMethod = 'online', fare = 250, collection } = {}) => {
  const _id = oid();
  const userId = oid();
  await Ride.collection.insertOne({
    _id, userId, status, paymentMethod, fare, createdAt: new Date(),
    ...(collection ? { driverPaymentCollection: collection } : {}),
  });
  return { _id, userId };
};
const walletOf = async (userId) => Number((await CustomerWallet.findOne({ userId }).lean())?.balance || 0);
const online = (amount, providerPaymentId = 'mock_pay_1') => ({ provider: 'razorpay', providerPaymentId, status: 'paid', amount });

console.log('\ntaxi ride refunds');

await check('online ride: partial then the rest, to Razorpay, kept on the ride', async () => {
  const { _id } = await makeRide({ collection: online(250) });
  const first = await refundRideByAdmin(String(_id), { amount: 50, reason: 'long route', adminId });
  assert.match(first.refund.refundId, /^mock_rfnd_/);
  assert.equal(first.refund.refundableLeft, 200);
  await refundRideByAdmin(String(_id), { reason: 'refund the rest', adminId });
  const r = await Ride.findById(_id).lean();
  assert.equal(r.adminRefund.status, 'processed');
  assert.equal(r.adminRefund.refundedPaise, 25000);
  assert.deepEqual(r.adminRefund.history.map((h) => h.amount), [50, 200]);
  assert.equal(r.adminRefund.history[0].byAdminId, adminId);
  const again = await thrownBy(() => refundRideByAdmin(String(_id), { amount: 1, reason: 'again', adminId }));
  assert.equal(again?.statusCode, 400);
});

await check('capped at what is left; zero and missing reason refused', async () => {
  const { _id } = await makeRide({ collection: { provider: 'wallet', status: 'paid', amount: 100 } });
  const over = await thrownBy(() => refundRideByAdmin(String(_id), { amount: 100.01, reason: 'over', adminId }));
  assert.equal(over?.statusCode, 400);
  const zero = await thrownBy(() => refundRideByAdmin(String(_id), { amount: 0, reason: 'zero', adminId }));
  assert.equal(zero?.statusCode, 400);
  const noReason = await thrownBy(() => refundRideByAdmin(String(_id), { amount: 10, adminId }));
  assert.equal(noReason?.statusCode, 400);
});

await check('wallet-paid ride refunds to the wallet', async () => {
  const { _id, userId } = await makeRide({ collection: { provider: 'wallet', status: 'paid', amount: 120 } });
  const r = await refundRideByAdmin(String(_id), { amount: 120, reason: 'driver no-show', adminId });
  assert.equal(r.refund.method, 'wallet');
  assert.equal(await walletOf(userId), 120);
});

await check('cash ride refunds to the wallet, and says so', async () => {
  const { _id, userId } = await makeRide({ paymentMethod: 'cash', fare: 90 });
  await refundRideByAdmin(String(_id), { amount: 40, reason: 'overcharged', adminId });
  assert.equal(await walletOf(userId), 40);
  const w = await CustomerWallet.findOne({ userId }).lean();
  assert.match(w.transactions[0].title, /cash/);
});

await check('an unpaid or ongoing ride cannot be refunded', async () => {
  const cancelledCash = await makeRide({ status: 'cancelled', paymentMethod: 'cash' });
  assert.equal((await thrownBy(() => refundRideByAdmin(String(cancelledCash._id), { reason: 'test', adminId })))?.statusCode, 400);
  const ongoing = await makeRide({ status: 'ongoing', collection: online(100) });
  assert.equal((await thrownBy(() => refundRideByAdmin(String(ongoing._id), { reason: 'test', adminId })))?.statusCode, 400);
});

await check('cancelled ride that was paid online can be refunded', async () => {
  const { _id } = await makeRide({ status: 'cancelled', collection: online(80, 'mock_pay_2') });
  const r = await refundRideByAdmin(String(_id), { reason: 'cancelled after paying', adminId });
  assert.equal(r.refund.amount, 80);
});

await check('two full refunds at once: exactly one pays', async () => {
  const { _id, userId } = await makeRide({ collection: { provider: 'wallet', status: 'paid', amount: 200 } });
  const results = await Promise.allSettled([
    refundRideByAdmin(String(_id), { reason: 'click one', adminId }),
    refundRideByAdmin(String(_id), { reason: 'click two', adminId }),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(await walletOf(userId), 200);
  assert.equal((await Ride.findById(_id).lean()).adminRefund.history.length, 1);
});

await check('a failed gateway refund gives the claim back', async () => {
  const { _id } = await makeRide({ collection: online(150, 'pay_real_1') });
  const err = await thrownBy(() => refundRideByAdmin(String(_id), { amount: 50, reason: 'try it', adminId }));
  assert.equal(err?.statusCode, 424, err?.message);
  const r = await Ride.findById(_id).lean();
  assert.equal(r.adminRefund?.status ?? 'none', 'none');
  assert.equal(r.adminRefund?.refundedPaise ?? 0, 0);
  assert.equal(r.adminRefund?.history?.length ?? 0, 0);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
