/**
 * One address book: Quick and the Shop use the platform account's addresses,
 * shared with Food, Rides and Services.
 *
 * Run: node tests/one-address-book.smoke.mjs
 *
 * What this guards:
 *   - addresses a customer saved only in Quick are brought over once, keeping
 *     their ids; the account's own address wins where a label is taken;
 *   - an address added in the Shop is the one Quick and Food then see;
 *   - the account keeps a brought-over address's old id, which Quick's
 *     checkout looks it up by;
 *   - a customer with no platform account keeps the service's own copy.
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
await mongoose.connect(mongo.getUri('one_address_book'));
const db = mongoose.connection;

const quick = await import('../src/modules/quickCommerce/modules/food/user/services/userAddress.service.js');
const shop = await import('../src/modules/ecommerce/modules/commerce/user/services/userAddress.service.js');
const food = await import('../src/modules/food/user/services/userAddress.service.js');

const oid = () => new mongoose.Types.ObjectId();
const addr = (label, street) => ({
    _id: oid(), label, street, additionalDetails: '', city: 'Bengaluru', state: 'KA', zipCode: '560038', phone: '',
    location: { type: 'Point', coordinates: [77.64, 12.97] }, isDefault: false,
});

const platformId = oid();
const qcId = oid();
const shopId = oid();
const qcHome = addr('Home', '12 Quick Street');
const qcOffice = addr('Office', 'Quick office');
await db.collection('users').insertOne({ _id: platformId, name: 'Asha', phone: '9000000001', addresses: [{ ...addr('Office', 'Account office'), isDefault: true }] });
await db.collection('qc_users').insertOne({ _id: qcId, phone: '9000000001', platformUserId: platformId, addresses: [qcHome, qcOffice] });
await db.collection('ecom_users').insertOne({ _id: shopId, phone: '9000000001', platformUserId: platformId, addresses: [] });

const streets = (list) => list.map((a) => `${a.label}:${a.street}`).sort();

await check("Quick's own addresses come over once, ids kept; the account's Office wins", async () => {
    const { addresses } = await quick.listAddresses(String(qcId));
    assert.deepEqual(streets(addresses), ['Home:12 Quick Street', 'Office:Account office']);
    const account = await db.collection('users').findOne({ _id: platformId });
    assert.ok(account.addresses.some((a) => String(a._id) === String(qcHome._id)));
    assert.ok((await db.collection('qc_users').findOne({ _id: qcId })).addressesMergedAt);
    // A second read does not copy again.
    await quick.listAddresses(String(qcId));
    assert.equal((await db.collection('users').findOne({ _id: platformId })).addresses.length, 2);
});

await check('an address added in the Shop is the one Quick and Food see', async () => {
    await shop.addAddress(String(shopId), { label: 'Other', street: 'Gym', city: 'Bengaluru', state: 'KA', latitude: 12.9, longitude: 77.6 });
    const inQuick = streets((await quick.listAddresses(String(qcId))).addresses);
    const inFood = streets((await food.listAddresses(String(platformId))).addresses);
    assert.ok(inQuick.includes('Other:Gym'));
    assert.deepEqual(inQuick, inFood);
});

await check('the account holds the brought-over address under its old id (what checkout looks up)', async () => {
    const { addressBookOwner } = await import('../src/core/identity/addressBook.js');
    const owner = await addressBookOwner(String(qcId), 'qc_users');
    assert.equal(owner, String(platformId));
    const account = await db.collection('users').findOne({ _id: platformId });
    assert.ok(account.addresses.find((a) => String(a._id) === String(qcHome._id)));
});

await check('a customer with no platform account keeps the service copy', async () => {
    const loneId = oid();
    await db.collection('qc_users').insertOne({ _id: loneId, phone: '9111111199', addresses: [addr('Home', 'Lone street')] });
    const { addresses } = await quick.listAddresses(String(loneId));
    assert.deepEqual(streets(addresses), ['Home:Lone street']);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll address book checks passed');
