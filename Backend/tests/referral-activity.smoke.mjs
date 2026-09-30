/**
 * Master > Referral activity: every service's referral log in one list, with
 * names, rewards and per-service totals, filtered by service, status and date.
 *
 * Run: node tests/referral-activity.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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
await mongoose.connect(mongo.getUri(), { dbName: 'referral_activity' });
const db = mongoose.connection;
const { listReferralActivity, invitesOfPerson } = await import('../src/core/referral/referralActivity.service.js');

const id = () => new mongoose.Types.ObjectId();
const [ann, bob, qa, qb, sa, sb] = [id(), id(), id(), id(), id(), id()];
await db.collection('users').insertMany([{ _id: ann, name: 'Ann', phone: '9000000001' }, { _id: bob, name: 'Bob', phone: '9000000002' }]);
await db.collection('qc_users').insertMany([{ _id: qa, name: 'Qa' }, { _id: qb, name: 'Qb', phone: '9000000004' }]);
await db.collection('sp_users').insertMany([{ _id: sa, name: 'Sa' }, { _id: sb, name: 'Sb' }]);
const t = (daysAgo) => new Date(Date.now() - daysAgo * 86400000);
await db.collection('food_referral_logs').insertMany([
  { referrerId: ann, refereeId: bob, role: 'USER', rewardAmount: 50, status: 'credited', createdAt: t(1) },
  { referrerId: ann, refereeId: id(), role: 'USER', rewardAmount: 0, status: 'rejected', reason: 'limit_reached', refereePhone: '9000000009', createdAt: t(40) },
]);
await db.collection('qc_referral_logs').insertOne({ referrerId: qa, refereeId: qb, role: 'USER', rewardAmount: 30, status: 'credited', createdAt: t(2) });
await db.collection('sp_referral_logs').insertOne({ referrerId: sa, refereeId: sb, reward: 20, status: 'credited', createdAt: t(3) });

await check('every service, newest first, with names and rewards', async () => {
  const { items } = await listReferralActivity();
  assert.deepEqual(items.map((i) => i.service), ['food', 'quick', 'services', 'food']);
  assert.equal(items[0].referrer.name, 'Ann');
  assert.equal(items[0].referee.name, 'Bob');
  assert.equal(items[0].reward, 50);
  assert.equal(items[2].reward, 20); // Services calls it `reward`
  assert.equal(items[3].referee.phone, '9000000009'); // unknown referee: the logged phone
});

await check('per-service totals count what was credited and paid', async () => {
  const { summary } = await listReferralActivity();
  const food = summary.find((s) => s.service === 'food');
  assert.deepEqual([food.credited, food.rejected, food.rewardsPaid], [1, 1, 50]);
  assert.equal(summary.find((s) => s.service === 'services').rewardsPaid, 20);
});

await check('filters: service, status and date range', async () => {
  assert.deepEqual((await listReferralActivity({ service: 'quick' })).items.map((i) => i.referrer.name), ['Qa']);
  assert.equal((await listReferralActivity({ status: 'rejected' })).items.length, 1);
  const from = t(10).toISOString().slice(0, 10);
  assert.equal((await listReferralActivity({ from })).items.length, 3);
});

await check('Rides is listed from its own log', async () => {
  const cara = id();
  await db.collection('users').insertOne({ _id: cara, name: 'Cara', phone: '9000000005' });
  await db.collection('taxi_referral_logs').insertOne({ referrerId: ann, refereeId: cara, role: 'USER', kind: 'after_rides', rewardAmount: 40, status: 'pending', createdAt: t(0) });
  const { items, summary } = await listReferralActivity({ service: 'rides' });
  assert.equal(items.length, 1);
  assert.equal(items[0].serviceLabel, 'Rides');
  assert.deepEqual([items[0].referrer.name, items[0].referee.name, items[0].status], ['Ann', 'Cara', 'pending']);
  assert.equal(summary[0].pending, 1);
});

await check('a customer sees the friends they invited in every service', async () => {
  // Ann's Quick row is linked to her account; her Food and Rides invites are on it directly.
  await db.collection('qc_users').updateOne({ _id: qa }, { $set: { platformUserId: ann } });
  const friends = await invitesOfPerson(ann);
  assert.deepEqual(friends.map((f) => f.serviceLabel), ['Rides', 'Food', 'Quick', 'Food']);
  const quick = friends.find((f) => f.service === 'quick');
  assert.deepEqual([quick.name, quick.phone, quick.status, quick.earnedAmount], ['Qb', '900*****04', 'credited', 30]);
  // A refused invite has no earnings; an unknown friend shows the logged phone, masked.
  const refused = friends.find((f) => f.status === 'rejected');
  assert.deepEqual([refused.name, refused.phone, refused.earnedAmount], ['Friend', '900*****09', 0]);
  assert.deepEqual(await invitesOfPerson(bob), []);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll referral activity checks passed');
