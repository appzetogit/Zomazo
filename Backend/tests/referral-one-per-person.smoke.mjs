/**
 * One customer referral reward per person across the platform (decided
 * 30 Sep 2026): the first service to reward a phone keeps it, and every other
 * service's programme pays nothing for that person.
 *
 * Run: node tests/referral-one-per-person.smoke.mjs
 *
 * What this guards (through Food's and Quick's real sign-ins):
 *   - Quick pays first, then Food refuses the same phone (rewarded_in_other_service),
 *     and the other way round;
 *   - a phone already credited in an older log (the Shop's) counts as taken;
 *   - a programme that claims but cannot pay (its referrer is at the cap) gives
 *     the claim back, so another service can still reward that person;
 *   - the register itself: same-programme retries are harmless, bad phones are
 *     not enforced.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';

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
process.env.MONGODB_URI = mongo.getUri('referral_one_per_person');
await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;

const claims = await import('../src/core/referral/referralClaim.service.js');
const foodAuth = await import('../src/core/auth/auth.service.js');
const quickAuth = await import('../src/modules/quickCommerce/core/auth/auth.service.js');
const { FoodReferralSettings } = await import('../src/modules/food/admin/models/referralSettings.model.js');
const { FoodReferralLog } = await import('../src/modules/food/admin/models/referralLog.model.js');
const { FoodReferralSettings: QuickSettings } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralSettings.model.js');
const { FoodReferralLog: QuickLog } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralLog.model.js');

await FoodReferralSettings.create({ referralRewardUser: 30, referralLimitUser: 10, isActive: true });
await QuickSettings.create({ referralRewardUser: 20, referralLimitUser: 10, isActive: true });

const foodReferrer = (await db.collection('users').insertOne({ phone: '9100000001', name: 'Asha', role: 'USER', isVerified: true, referralCode: 'ASHA1', referralCount: 0 })).insertedId;
// An old Quick code (a qc_users id): merged into users, same _id, on first use.
const quickReferrer = (await db.collection('qc_users').insertOne({ phone: '9100000002', name: 'Ravi', isVerified: true, referralCount: 0 })).insertedId;

const foodSignUp = async (phone) => {
    const { otp } = await foodAuth.requestUserOtp(phone);
    return foodAuth.verifyUserOtpAndLogin(phone, otp, String(foodReferrer), null, 'web', 'New');
};
const quickSignUp = async (phone) => {
    const { otp } = await quickAuth.requestUserOtp(phone);
    return quickAuth.verifyUserOtpAndLogin(phone, otp, String(quickReferrer), null, 'web', 'New');
};
const foodLog = (phone) => FoodReferralLog.findOne({ refereePhone: phone }).sort({ createdAt: -1 }).lean();
const quickLog = (phone) => QuickLog.findOne({ refereePhone: phone }).sort({ createdAt: -1 }).lean();

console.log('\nAcross services');

// Quick's sign-in makes the platform account, so a later Food sign-in is not
// a new account and never reaches referrals; the services that still can
// (the Shop, Services, Rides) ask the register, as here.
await check('Quick rewards a person first; another service is then refused', async () => {
    await quickSignUp('9200000001');
    assert.equal((await quickLog('9200000001'))?.status, 'credited');
    const shop = await claims.claimReferralForPhone({ phone: '9200000001', programme: 'ecommerce' });
    assert.deepEqual(shop, { claimed: false, heldBy: 'quickCommerce' });
});

await check('and the other way round: Food first, Quick refuses', async () => {
    await foodSignUp('9200000002');
    assert.equal((await foodLog('9200000002'))?.status, 'credited');
    await quickSignUp('9200000002');
    const log = await quickLog('9200000002');
    assert.equal(log?.status, 'rejected');
    assert.equal(log?.reason, 'rewarded_in_other_service');
    assert.equal((await db.collection('users').findOne({ _id: quickReferrer })).quickReferralCount, 1);
});

await check('a reward in an older log (the Shop) counts as taken', async () => {
    await db.collection('ecom_referral_logs').insertOne({ refereePhone: '9200000003', role: 'USER', status: 'credited' });
    await foodSignUp('9200000003');
    assert.equal((await foodLog('9200000003'))?.reason, 'rewarded_in_other_service');
    const held = await claims.PlatformReferralClaim.findOne({ phone: '9200000003' }).lean();
    assert.equal(held?.programme, 'ecommerce');
});

await check('a service that cannot pay (cap reached) gives the person back', async () => {
    await db.collection('users').updateOne({ _id: quickReferrer }, { $set: { quickReferralCount: 10 } });
    await quickSignUp('9200000004');
    assert.equal((await quickLog('9200000004'))?.reason, 'limit_reached');
    assert.equal(await claims.PlatformReferralClaim.countDocuments({ phone: '9200000004' }), 0);
    const rides = await claims.claimReferralForPhone({ phone: '9200000004', programme: 'taxi' });
    assert.equal(rides.claimed, true);
});

console.log('\nThe register');

await check('the same programme claiming again is harmless', async () => {
    const a = await claims.claimReferralForPhone({ phone: '+91 92000 00009', programme: 'taxi' });
    const b = await claims.claimReferralForPhone({ phone: '9200000009', programme: 'taxi' });
    const c = await claims.claimReferralForPhone({ phone: '9200000009', programme: 'serviceProvider' });
    assert.deepEqual([a.claimed, b.claimed, c.claimed, c.heldBy], [true, true, false, 'taxi']);
});

await check('a phone that cannot be read is left to each programme', async () => {
    const r = await claims.claimReferralForPhone({ phone: '12', programme: 'taxi' });
    assert.equal(r.unenforced, true);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll one-per-person referral checks passed');
process.exit(failed ? 1 : 0);
