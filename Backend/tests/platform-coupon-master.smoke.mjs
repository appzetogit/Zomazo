/**
 * Master > Coupons makes, lists, edits and pauses platform coupons, and only
 * for admins with offers access in every service a coupon names.
 *
 * Run: node tests/platform-coupon-master.smoke.mjs
 */
import assert from 'node:assert/strict';
import express from 'express';
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
process.env.MONGODB_URI = mongo.getUri('platform_coupon_master');
await mongoose.connect(mongo.getUri('platform_coupon_master'));

const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');

const app = express();
app.use(express.json());
app.use('/api', routes);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1/platform/coupons`;

const owner = await FoodAdmin.create({
    email: 'owner@x.in', password: 'secret1', name: 'Owner', adminLevel: 'platform_superadmin',
    admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'ecommerce', 'taxi', 'serviceProvider'],
});
const foodOffers = await FoodAdmin.create({
    email: 'offers@x.in', password: 'secret1', name: 'Food offers', parentAdminId: owner._id, module: 'food',
    admin_type: 'subadmin', permissions: ['promotions.write'], servicesAccess: ['food'],
});
const call = async (method, path, admin, body) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${signAccessToken({ userId: String(admin._id), role: 'ADMIN' })}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};

let created;
await check('the owner makes a coupon for Food and the Shop', async () => {
    const r = await call('POST', '/platform', owner, { code: 'everywhere50', services: ['food', 'ecommerce'], discountType: 'flat', discountValue: 50, minOrderValue: 199 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    created = r.body.data;
    assert.equal(created.code, 'EVERYWHERE50');
});

await check('it is listed as an all-services coupon, live', async () => {
    const r = await call('GET', '/?source=platform', owner);
    const row = r.body.data.items.find((i) => i.code === 'EVERYWHERE50');
    assert.ok(row, 'listed');
    assert.equal(row.where, 'Food, Shop');
    assert.equal(row.state, 'live');
});

await check('a Food-only offers admin cannot make one the Shop honours, nor pause this one', async () => {
    const make = await call('POST', '/platform', foodOffers, { code: 'SNEAKY', services: ['food', 'ecommerce'], discountType: 'flat', discountValue: 10 });
    assert.equal(make.status, 403);
    const pause = await call('PATCH', `/platform/${created._id}/live`, foodOffers, { live: false });
    assert.equal(pause.status, 403);
    const foodOnly = await call('POST', '/platform', foodOffers, { code: 'FOODFEST', services: ['food'], discountType: 'percentage', discountValue: 10 });
    assert.equal(foodOnly.status, 200, 'but a Food-only one is theirs to make');
});

await check('a code another service uses is refused with a clear message', async () => {
    await FoodOffer.collection.insertOne({ couponCode: 'TAKEN10', discountValue: 10 });
    const r = await call('POST', '/platform', owner, { code: 'TAKEN10', services: ['ecommerce'], discountType: 'flat', discountValue: 10 });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /already used by a Food coupon/);
});

await check('the owner edits and pauses it', async () => {
    const edit = await call('PATCH', `/platform/${created._id}`, owner, { discountValue: 75, services: ['food', 'ecommerce', 'taxi'] });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.discountValue, 75);
    const pause = await call('PATCH', `/platform/${created._id}/live`, owner, { live: false });
    assert.equal(pause.status, 200, JSON.stringify(pause.body));
    assert.equal(pause.body.data.state, 'paused');
});

server.close();
await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Master platform coupon checks passed');
process.exit(0);
