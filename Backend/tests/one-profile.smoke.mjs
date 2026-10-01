/**
 * One profile: Quick, the Shop and Services show the customer's name, email and
 * photo from their platform account, and an edit in any of them is saved there.
 *
 * Run: node tests/one-profile.smoke.mjs
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
await mongoose.connect(mongo.getUri('one_profile'));
const db = mongoose.connection;

// The session middleware translates a Quick id (the qc_users merge) before any service sees it.
const { resolveQuickCustomerId } = await import('../src/core/identity/quickCustomer.js');
const { resolveShopCustomerId } = await import('../src/core/identity/shopCustomer.js');
const quick = await import('../src/modules/quickCommerce/modules/food/user/services/userProfile.service.js');
const shop = await import('../src/modules/ecommerce/modules/commerce/user/services/userProfile.service.js');
const { withSharedProfile, saveSharedProfile } = await import('../src/core/identity/sharedProfile.js');

const oid = () => new mongoose.Types.ObjectId();
const platformId = oid();
const qcId = oid();
const shopId = oid();
const spId = oid();
await db.collection('users').insertOne({ _id: platformId, name: 'Asha Rao', email: 'asha@x.in', phone: '9000000001', profileImage: 'https://img/asha.jpg' });
await db.collection('qc_users').insertOne({ _id: qcId, name: 'Old Quick Name', phone: '9000000001', platformUserId: platformId, role: 'USER' });
await db.collection('ecom_users').insertOne({ _id: shopId, name: '', phone: '9000000001', platformUserId: platformId, role: 'USER' });
await db.collection('sp_users').insertOne({ _id: spId, name: 'Old SP', phone: '9000000001', platformUserId: platformId, profilePhoto: '' });

await check("Quick and the Shop show the account's name, email and photo", async () => {
    const q = (await quick.getCurrentUserProfile(await resolveQuickCustomerId(String(qcId)))).user;
    const s = (await shop.getCurrentUserProfile(await resolveShopCustomerId(String(shopId)))).user;
    for (const u of [q, s]) {
        assert.equal(u.name, 'Asha Rao');
        assert.equal(u.email, 'asha@x.in');
        assert.equal(u.profileImage, 'https://img/asha.jpg');
    }
});

await check('a name changed in the Shop is the name Quick and the account show', async () => {
    await shop.updateCurrentUserProfile(await resolveShopCustomerId(String(shopId)), { name: 'Asha K' });
    assert.equal((await db.collection('users').findOne({ _id: platformId })).name, 'Asha K');
    assert.equal((await quick.getCurrentUserProfile(await resolveQuickCustomerId(String(qcId)))).user.name, 'Asha K');
});

await check("Services' photo field maps to the account's photo both ways", async () => {
    const shown = await withSharedProfile(await db.collection('sp_users').findOne({ _id: spId }), { profilePhoto: 'profileImage' });
    assert.equal(shown.profilePhoto, 'https://img/asha.jpg');
    await saveSharedProfile(String(spId), { profilePhoto: 'https://img/new.jpg' }, { profilePhoto: 'profileImage' });
    assert.equal((await db.collection('users').findOne({ _id: platformId })).profileImage, 'https://img/new.jpg');
});

await check('a customer with no platform account keeps their own details', async () => {
    const loneId = oid();
    await db.collection('qc_users').insertOne({ _id: loneId, name: 'Lone', phone: '9111111199', role: 'USER' });
    assert.equal((await quick.getCurrentUserProfile(await resolveQuickCustomerId(String(loneId)))).user.name, 'Lone');
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll profile checks passed');
