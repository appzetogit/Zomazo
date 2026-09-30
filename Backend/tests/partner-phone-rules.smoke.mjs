/**
 * A partner's own profile cannot move their sign-in number, or take another
 * business's number as their contact number (core/partner/partnerPhoneRules.js),
 * in Food, Quick and the Shop.
 *
 * Run: node tests/partner-phone-rules.smoke.mjs
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
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('partner_phone_rules');
await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;

const services = [
  {
    label: 'Food',
    collection: 'food_restaurants',
    name: { restaurantName: 'Mine' },
    update: (await import('../src/modules/food/restaurant/services/restaurant.service.js')).updateRestaurantProfile,
  },
  {
    label: 'Quick',
    collection: 'qc_restaurants',
    name: { restaurantName: 'Mine' },
    update: (await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurant.service.js')).updateRestaurantProfile,
  },
  {
    label: 'Shop',
    collection: 'ecom_sellers',
    name: { sellerName: 'Mine' },
    update: (await import('../src/modules/ecommerce/modules/commerce/seller/services/seller.service.js')).updateSellerProfile,
  },
];

for (const s of services) {
  console.log(`\n${s.label}`);
  const mine = new mongoose.Types.ObjectId();
  await db.collection(s.collection).insertMany([
    { _id: mine, ...s.name, ownerPhone: '9000000001', primaryContactNumber: '9000000001', status: 'approved' },
    { ...s.name, ownerPhone: '9000000002', primaryContactNumber: '9000000003', status: 'approved' },
  ]);
  const doc = () => db.collection(s.collection).findOne({ _id: mine });

  await check('the sign-in number, sent back as it is (any format), is fine', async () => {
    await s.update(String(mine), { ownerPhone: '+91 90000 00001' });
    assert.equal((await doc()).ownerPhone, '9000000001');
  });

  await check('the sign-in number cannot be changed', async () => {
    await assert.rejects(() => s.update(String(mine), { ownerPhone: '9000000009' }), /cannot be changed here/);
    assert.equal((await doc()).ownerPhone, '9000000001');
  });

  await check('the contact number can change to a free number', async () => {
    await s.update(String(mine), { primaryContactNumber: '9000000007' });
    assert.equal((await doc()).primaryContactNumber, '9000000007');
  });

  await check('but not to another business\'s sign-in or contact number', async () => {
    await assert.rejects(() => s.update(String(mine), { primaryContactNumber: '+91 9000000002' }), /already used by another business/);
    await assert.rejects(() => s.update(String(mine), { primaryContactNumber: '9000000003' }), /already used by another business/);
    assert.equal((await doc()).primaryContactNumber, '9000000007');
  });

  await check('its own sign-in number as contact is fine', async () => {
    await s.update(String(mine), { primaryContactNumber: '9000000001' });
    assert.equal((await doc()).primaryContactNumber, '9000000001');
  });
}

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll partner phone rule checks passed');
process.exit(failed ? 1 : 0);
