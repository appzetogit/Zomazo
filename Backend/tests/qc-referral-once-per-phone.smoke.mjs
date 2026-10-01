/**
 * Quick commerce's own sign-in pays a referral once per phone number, ever,
 * and never past the referrer's cap -- the two rules the platform sign-in has
 * had, which this fork had drifted without (Phase 3).
 *
 * Run: node tests/qc-referral-once-per-phone.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_referral_phone');
await mongoose.connect(mongo.getUri('qc_referral_phone'));
const db = mongoose.connection;

const auth = await import('../src/modules/quickCommerce/core/auth/auth.service.js');
const { FoodReferralSettings } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralSettings.model.js');
const { FoodReferralLog } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralLog.model.js');

await FoodReferralSettings.create({ referralRewardUser: 20, referralLimitUser: 5, isActive: true });
const referrer = await db.collection('qc_users').insertOne({ phone: '9000000001', name: 'Ravi', isVerified: true, referralCount: 0 });
const ref = String(referrer.insertedId);

const signUp = async (phone) => {
    const { otp } = await auth.requestUserOtp(phone);
    return auth.verifyUserOtpAndLogin(phone, otp, ref, null, 'web', 'New');
};
// The referrer's code is their old Quick id: they are merged into `users`
// (same _id, having no platform account) the first time it is used. Quick's
// own count is quickReferralCount there.
const referralCount = async () => (await db.collection('users').findOne({ _id: referrer.insertedId }))?.quickReferralCount;

await check('a new customer signing up with the code pays the referrer once', async () => {
    await signUp('9000000002');
    assert.equal(await referralCount(), 1);
    const log = await FoodReferralLog.findOne({ status: 'credited' }).lean();
    assert.equal(log?.refereePhone, '9000000002');
});

await check('the same phone, after deleting the account, is not paid again', async () => {
    await db.collection('users').deleteOne({ phone: '9000000002' });
    await signUp('9000000002');
    assert.equal(await referralCount(), 1);
    const refused = await FoodReferralLog.findOne({ status: 'rejected', reason: 'phone_already_rewarded' }).lean();
    assert.ok(refused, 'expected a phone_already_rewarded refusal');
});

await check('the cap holds: a referrer at the limit is not paid', async () => {
    await db.collection('users').updateOne({ _id: referrer.insertedId }, { $set: { quickReferralCount: 5 } });
    await signUp('9000000003');
    assert.equal(await referralCount(), 5);
    assert.ok(await FoodReferralLog.findOne({ reason: 'limit_reached' }).lean());
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Quick referral checks passed');
