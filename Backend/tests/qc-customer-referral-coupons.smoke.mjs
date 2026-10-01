/**
 * Quick's customer app: Refer & Earn and the coupon list, for a customer who
 * signed in on the platform.
 *
 * Run: node tests/qc-customer-referral-coupons.smoke.mjs
 *
 * What this guards:
 *   - /qc/user/referrals/* for a Quick account linked to a platform account
 *     hands out the PLATFORM id as the code with a /login?ref= link (the only
 *     code the platform sign-in credits) and reports the platform's numbers;
 *   - a Quick-only account with no platform link keeps its own code;
 *   - /qc/restaurant/offers, reached with a platform token, filters by the
 *     customer's Quick account: a first-order coupon is not listed to someone
 *     who has already ordered.
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

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());

const referral = await import('../src/modules/quickCommerce/modules/food/user/services/userReferral.service.js');
const { listPublicOffersController } = await import('../src/modules/quickCommerce/modules/food/restaurant/controllers/restaurant.controller.js');
// Rows from before the qc_users merge: the session middleware translates a
// customer's id (resolveQuickCustomerId) before any of these services see it.
const { LegacyQcUser: QuickUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const { resolveQuickCustomerId } = await import('../src/core/identity/quickCustomer.js');
const { FoodUser: PlatformUser } = await import('../src/core/users/user.model.js');
const { FoodReferralLog: PlatformReferralLog } = await import('../src/modules/food/admin/models/referralLog.model.js');
const { FoodOffer: QuickOffer } = await import('../src/modules/quickCommerce/modules/food/admin/models/offer.model.js');
const { FoodOrder: QuickOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');

const oid = () => new mongoose.Types.ObjectId();
const store = oid();
const asha = oid();
const ashaQuick = oid();
const friend = oid();
const loner = oid();

await PlatformUser.collection.insertMany([
  { _id: asha, phone: '9876543210', referralCode: String(asha), referralCount: 2 },
  { _id: friend, phone: '9123456789', name: 'Ravi' },
]);
await QuickUser.collection.insertMany([
  { _id: ashaQuick, platformUserId: asha, phone: '9876543210', referralCode: 'QUICKONLY', referralCount: 0 },
  { _id: loner, phone: '9000000000', referralCode: 'LONER1' },
]);
// Asha's Quick order, from before the merge: keyed by her Quick row.
await QuickOrder.collection.insertOne({ userId: ashaQuick, restaurantId: store, orderStatus: 'delivered', createdAt: new Date() });
await PlatformReferralLog.collection.insertOne({
  referrerId: asha, refereeId: friend, role: 'USER', rewardAmount: 50, status: 'credited', createdAt: new Date(),
});

console.log('\nRefer & earn');
await check('a linked customer gets the platform id as the code, and a /login?ref= link', async () => {
  const stats = await referral.getUserReferralStats(await resolveQuickCustomerId(ashaQuick));
  assert.equal(stats.referralCode, String(asha));
  assert.equal(stats.referralLink, `/login?ref=${asha}`);
  assert.equal(stats.referralCount, 2, 'the platform count, not the Quick one');
});
await check('their invited friends are the ones the platform sign-in credited', async () => {
  const d = await referral.getUserReferralDetails(await resolveQuickCustomerId(ashaQuick));
  assert.equal(d.stats.referralCode, String(asha));
  assert.equal(d.stats.totalInvited, 1);
  assert.equal(d.stats.creditedCount, 1);
  assert.equal(d.invitedFriends[0].name, 'Ravi');
});
await check('a Quick-only account keeps its own code', async () => {
  const stats = await referral.getUserReferralStats(await resolveQuickCustomerId(loner));
  assert.equal(stats.referralCode, 'LONER1');
});

console.log('\nCoupon list');
await QuickOffer.collection.insertMany([
  { couponCode: 'WELCOME', discountType: 'flat-price', discountValue: 50, status: 'active', restaurantScope: 'all', customerScope: 'first-time', showInCart: true },
  { couponCode: 'EVERYONE', discountType: 'percentage', discountValue: 10, status: 'active', restaurantScope: 'all', customerScope: 'all', showInCart: true },
]);

const callOffers = (user) =>
  new Promise((resolve, reject) => {
    const res = {
      status() { return this; },
      json(body) { resolve(body); return this; },
    };
    listPublicOffersController({ query: { restaurantId: String(store) }, user }, res, reject);
  });
const codes = (body) => (body?.data?.allOffers || []).map((o) => o.couponCode).sort();

await check('a platform token is filtered as the customer\'s Quick account', async () => {
  const body = await callOffers({ userId: String(asha), role: 'USER' });
  assert.deepEqual(codes(body), ['EVERYONE']);
});
await check('a Quick token is filtered the same way', async () => {
  const body = await callOffers({ userId: String(ashaQuick), role: 'USER' });
  assert.deepEqual(codes(body), ['EVERYONE']);
});
await check('signed out, every live coupon is listed', async () => {
  const body = await callOffers(undefined);
  assert.deepEqual(codes(body), ['EVERYONE', 'WELCOME']);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
