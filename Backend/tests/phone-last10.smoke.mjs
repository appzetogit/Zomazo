// Sign-in finds partners, sellers, riders and customers by an indexed
// last-10-digit field instead of a suffix regex that read the whole collection.
//
//  - a number saved as '+91 98765 43210' is still found when signing in with
//    '9876543210' (and the other way round)
//  - the hooks stamp the field on create and on updates that change the phone
//  - a row written before the field existed is still found (fallback), and the
//    backfill stamps it
//  - the lookup is an index scan, never a collection scan
//
// Run: NODE_ENV=test MONGOMS_VERSION=7.0.24 node tests/phone-last10.smoke.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let failures = 0;
const check = (name, fn) => {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(48).toString('hex');
// The sign-in calls below read the code from the response.
process.env.USE_DEFAULT_OTP = 'true';
process.env.OTP_RATE_LIMIT = '1000';

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri());

const require = createRequire(import.meta.url);
const { byLast10 } = require('../src/core/identity/phoneLast10.cjs');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const auth = await import('../src/core/auth/auth.service.js');
const { backfillPhoneLast10 } = await import('../scripts/migrations/backfillPhoneLast10.mjs');
await Promise.all([FoodDeliveryPartner.init(), FoodRestaurant.init(), FoodUser.init()]);

const PAIRS = [['phone', 'phoneLast10']];
const planOf = async (Model, filter) => {
    const ex = await Model.find(filter).explain('queryPlanner');
    return JSON.stringify(ex.queryPlanner.winningPlan);
};

console.log('\n[1] the hooks stamp the field');
{
    const p = await FoodDeliveryPartner.create({ name: 'Asha', phone: '+91 98765 43210' });
    check('create stamps phoneLast10', () => assert.equal(p.phoneLast10, '9876543210'));
    await FoodDeliveryPartner.updateOne({ _id: p._id }, { $set: { phone: '+91-99999-00001' } });
    let row = await FoodDeliveryPartner.findById(p._id).lean();
    check('updateOne $set restamps it', () => assert.equal(row.phoneLast10, '9999900001'));
    await FoodDeliveryPartner.findOneAndUpdate({ _id: p._id }, { phone: '919876543210' });
    row = await FoodDeliveryPartner.findById(p._id).lean();
    check('findOneAndUpdate (plain field) restamps it', () => assert.equal(row.phoneLast10, '9876543210'));
}

console.log('\n[2] sign-in finds formatted numbers');
{
    const otp = (await auth.requestDeliveryOtp('9876543210')).otp;
    const res = await auth.verifyDeliveryOtpAndLogin('9876543210', otp);
    check('rider saved as 91.. signs in with 10 digits', () => assert.ok(!res.needsRegistration, JSON.stringify(res).slice(0, 120)));

    const r = await FoodRestaurant.collection.insertOne({ restaurantName: 'Spice', ownerPhone: '9123456789', status: 'approved' });
    await FoodRestaurant.updateOne({ _id: r.insertedId }, { $set: { ownerPhone: '+91 91234 56789' } });
    const rotp = (await auth.requestRestaurantOtp('+919123456789')).otp;
    const rres = await auth.verifyRestaurantOtpAndLogin('+919123456789', rotp);
    check('restaurant saved spaced signs in with +91', () => assert.ok(!rres.needsRegistration, JSON.stringify(rres).slice(0, 120)));
}

console.log('\n[3] rows from before the field: fallback, then backfill');
{
    await FoodDeliveryPartner.collection.insertOne({ name: 'Old', phone: '+91 90000 11111', status: 'approved' });
    const before = await FoodDeliveryPartner.findOne(byLast10('9000011111', PAIRS)).lean();
    check('an unstamped row is still found', () => assert.equal(before?.name, 'Old'));
    const dry = await backfillPhoneLast10({ log: () => {} });
    check('dry run counted the old rider', () => assert.ok(Object.values(dry).some((v) => v.toStamp >= 1)));
    const unstamped = await FoodDeliveryPartner.collection.findOne({ name: 'Old' });
    check('dry run wrote nothing', () => assert.equal(unstamped.phoneLast10, undefined));
    await backfillPhoneLast10({ apply: true, log: () => {} });
    const after = await FoodDeliveryPartner.collection.findOne({ name: 'Old' });
    check('--apply stamps it', () => assert.equal(after.phoneLast10, '9000011111'));
    const again = await backfillPhoneLast10({ log: () => {} });
    check('nothing left afterwards', () => assert.ok(Object.values(again).every((v) => v.toStamp === 0), JSON.stringify(again)));
}

console.log('\n[4] the lookup uses the index');
{
    const eq = await planOf(FoodDeliveryPartner, { phoneLast10: '9000011111' });
    check('equality is an IXSCAN', () => { assert.match(eq, /IXSCAN/); assert.doesNotMatch(eq, /COLLSCAN/); });
    const full = await planOf(FoodDeliveryPartner, byLast10('9000011111', PAIRS));
    check('the whole sign-in filter (with fallback) never scans the collection', () => {
        assert.match(full, /IXSCAN/);
        assert.doesNotMatch(full, /COLLSCAN/);
    });
    const owner = await planOf(FoodRestaurant, byLast10('9123456789', [['ownerPhone', 'ownerPhoneLast10'], ['primaryContactNumber', 'primaryContactLast10']]));
    check('the restaurant owner filter is index-only too', () => assert.doesNotMatch(owner, /COLLSCAN/));
    const users = await planOf(FoodUser, byLast10('9123456789', PAIRS));
    check('users lookup is index-only', () => assert.doesNotMatch(users, /COLLSCAN/));
}

console.log('\n[5] regex input is escaped');
{
    const f = byLast10('98.*', PAIRS);
    check('only digits reach the regex', () => assert.equal(f.$or[1].phone.$regex, String.raw`9\D*8\D*$`));
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures}`}\n`);
process.exit(failures ? 1 : 0);
