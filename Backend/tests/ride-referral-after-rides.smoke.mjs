/**
 * Rides' after-N-rides referral reward (conditional_referrer): logged pending
 * at sign-up, paid once when the new customer completes the Nth ride, and not
 * paid at all for someone another service already rewarded -- which Rides did
 * before, because Food sets the same `referredBy` on the one account.
 *
 * Run: node tests/ride-referral-after-rides.smoke.mjs
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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'ride_referral_after_rides' });
const db = mongoose.connection;

const { requestUserOtp, verifyUserOtpAndLogin } = await import('../src/core/auth/auth.service.js');
const { processCompletedRideReferralReward } = await import('../src/modules/taxi/services/rideService.js');
const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
const { UserWallet } = await import('../src/modules/taxi/user/models/UserWallet.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { claimReferralForPhone } = await import('../src/core/referral/referralClaim.service.js');

await AdminBusinessSetting.create({
  scope: 'default',
  referral: { user: { enabled: true, type: 'conditional_referrer', amount: 60, ride_count: 2 } },
});
const ravi = new mongoose.Types.ObjectId();
await db.collection('users').insertOne({ _id: ravi, phone: '9000000001', name: 'Ravi', isActive: true, referralCode: 'USRRAVI0001' });

const signUp = async (phone) => {
  const { otp } = await requestUserOtp(phone);
  const out = await verifyUserOtpAndLogin(phone, otp, 'USRRAVI0001', undefined, 'web', 'New', 'taxi');
  return out.user._id;
};
const completeRide = async (userId) => {
  const ride = { _id: new mongoose.Types.ObjectId(), userId, status: 'completed', serviceType: 'ride' };
  await Ride.collection.insertOne(ride);
  await processCompletedRideReferralReward(ride);
};
const log = (refereeId) => db.collection('taxi_referral_logs').findOne({ refereeId });
const rewardsFor = async (userId) =>
  ((await UserWallet.findOne({ userId }).lean())?.transactions || []).filter((t) => String(t.referenceKey || '').startsWith('user-referral:completed:'));

console.log('\nAfter N rides');

let asha;
await check('signing up with the code logs the invite as pending, and pays nothing yet', async () => {
  asha = await signUp('9100000001');
  const row = await log(asha);
  assert.deepEqual([row?.status, row?.kind, row?.rewardAmount], ['pending', 'after_rides', 60]);
  assert.equal(String(row.referrerId), String(ravi));
  assert.equal((await rewardsFor(ravi)).length, 0);
});

await check('one ride of two: still pending', async () => {
  await completeRide(asha);
  assert.equal((await log(asha)).status, 'pending');
  assert.equal((await rewardsFor(ravi)).length, 0);
});

await check('the second ride pays Ravi once, and the log says so', async () => {
  await completeRide(asha);
  assert.equal((await log(asha)).status, 'credited');
  const paid = await rewardsFor(ravi);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].amount, 60);
});

await check('more rides pay nothing more', async () => {
  await completeRide(asha);
  assert.equal((await rewardsFor(ravi)).length, 1);
});

await check('someone another service already rewarded is not paid again', async () => {
  const vik = await signUp('9100000002');
  // Food paid for Vikram first (the one-reward-per-person register holds him).
  await db.collection('platform_referral_claims').deleteOne({ phone: '9100000002' });
  assert.equal((await claimReferralForPhone({ phone: '9100000002', programme: 'food' })).claimed, true);
  await completeRide(vik);
  await completeRide(vik);
  const row = await log(vik);
  assert.deepEqual([row?.status, row?.reason], ['rejected', 'rewarded_in_other_service']);
  assert.equal((await rewardsFor(ravi)).length, 1);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll after-N-rides referral checks passed');
process.exit(failed ? 1 : 0);
