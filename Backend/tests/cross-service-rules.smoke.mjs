/**
 * Rules that were fixed in one service and had drifted out of the others
 * (Phase 3):
 *   - a Shop invite pays once per phone number, ever -- not once per Shop
 *     account, which deleting and signing up again renewed;
 *   - an admin's Cash on Delivery block on the customer's account is seen from
 *     Quick and Shop customer ids, not only Food's.
 *
 * Run: node tests/cross-service-rules.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('cross_service_rules');
await mongoose.connect(mongo.getUri('cross_service_rules'));
const db = mongoose.connection;

const { creditShopSignupReferral } = await import('../src/modules/ecommerce/modules/commerce/user/services/userReferral.service.js');
const { ReferralSettings } = await import('../src/modules/ecommerce/modules/commerce/admin/models/referralSettings.model.js');
const { ReferralLog } = await import('../src/modules/ecommerce/modules/commerce/admin/models/referralLog.model.js');
const { isBlockedFromCod } = await import('../src/core/identity/codBlock.js');

const oid = () => new mongoose.Types.ObjectId();

await check("the Shop's referral log keeps its own collection and the phone field", async () => {
    assert.equal(ReferralLog.collection.name, 'ecom_referral_logs');
    assert.ok(ReferralLog.schema.path('refereePhone'));
});

await ReferralSettings.create({ referralRewardUser: 30, referralLimitUser: 10, isActive: true });
const referrer = await db.collection('ecom_users').insertOne({ phone: '9000000001', name: 'Ravi', referralCount: 0, role: 'USER' });
const ref = String(referrer.insertedId);
const newShopRow = async (phone) => (await db.collection('ecom_users').insertOne({ phone, name: 'New', role: 'USER' })).insertedId;

await check('a new Shop customer signing up with the invite pays once', async () => {
    const first = await creditShopSignupReferral({ refereeId: String(await newShopRow('9000000002')), ref });
    assert.equal(first.credited, true, JSON.stringify(first));
});

await check('the same phone on a fresh Shop account is not paid again', async () => {
    // Shop customers are platform accounts since the ecom_users merge: a fresh
    // account for the same phone is a new platform account (the old one gone).
    await db.collection('users').deleteOne({ phone: '9000000002' });
    await db.collection('ecom_users').deleteOne({ phone: '9000000002' });
    const again = await creditShopSignupReferral({ refereeId: String(await newShopRow('9000000002')), ref });
    assert.equal(again.credited, false);
    assert.equal(again.reason, 'phone_already_rewarded');
    // The referrer's old Shop id is its platform id (it had no platform account).
    assert.equal((await db.collection('users').findOne({ _id: referrer.insertedId })).shopReferralCount, 1);
});

await check('a COD block on the account is seen from Quick and Shop ids', async () => {
    const platformId = oid();
    await db.collection('users').insertOne({ _id: platformId, phone: '9000000009', isBlockedFromCOD: true });
    const qcId = (await db.collection('qc_users').insertOne({ phone: '9000000009', platformUserId: platformId })).insertedId;
    const shopId = (await db.collection('ecom_users').insertOne({ phone: '9000000009', platformUserId: platformId })).insertedId;
    assert.equal(await isBlockedFromCod(String(qcId)), true);
    assert.equal(await isBlockedFromCod(String(shopId)), true);
    await db.collection('users').updateOne({ _id: platformId }, { $set: { isBlockedFromCOD: false } });
    assert.equal(await isBlockedFromCod(String(qcId)), false);
});

await check('a customer with no platform account is never blocked by mistake', async () => {
    const lone = (await db.collection('qc_users').insertOne({ phone: '9111111199' })).insertedId;
    assert.equal(await isBlockedFromCod(String(lone)), false);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll cross-service rule checks passed');
