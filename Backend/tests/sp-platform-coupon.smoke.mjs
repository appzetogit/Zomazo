/**
 * Services honours a platform coupon: checked and claimed against the
 * customer's platform account, and given back when the booking is cancelled
 * before work starts.
 *
 * Run: node tests/sp-platform-coupon.smoke.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);

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
await mongoose.connect(mongo.getUri('sp_platform_coupon'));
const db = mongoose.connection;

const couponService = require('../src/modules/serviceProvider/services/couponService.js');
const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
const core = await import('../src/core/promotions/platformCoupon.service.js');
await PlatformCouponUse.syncIndexes();

const person = async (phone) => {
    const platformId = new mongoose.Types.ObjectId();
    const spId = new mongoose.Types.ObjectId();
    await db.collection('users').insertOne({ _id: platformId, phone });
    await db.collection('sp_users').insertOne({ _id: spId, phone, platformUserId: platformId });
    return { platformId, spId };
};
const cy = await person('9000000071');
const di = await person('9000000072');
await PlatformCoupon.create({ code: 'HOME100', services: ['serviceProvider', 'food'], discountType: 'flat', discountValue: 100, perUserLimit: 1 });
const uses = async (who) => (await PlatformCouponUse.findOne({ platformUserId: who.platformId }).lean())?.count || 0;

let applied;
await check('checked and priced like a Services coupon', async () => {
    const r = await couponService.validateCoupon({ code: 'home100', userId: String(cy.spId), amount: 800 });
    assert.equal(r.discount, 100);
    assert.equal(r.coupon.platform, true);
    applied = r.coupon;
});

const bookingId = new mongoose.Types.ObjectId();
await check('claimed against the platform account when the booking is made', async () => {
    assert.equal(await couponService.claimCoupon(applied), true);
    await couponService.recordUsage({ coupon: applied, userId: cy.spId, bookingId, discount: 100 });
    assert.equal(await uses(cy), 1);
    await assert.rejects(couponService.validateCoupon({ code: 'HOME100', userId: String(cy.spId), amount: 800 }), /already used/);
});

await check('cancelled before work starts, the use comes back', async () => {
    assert.equal(await couponService.releaseCouponForBooking(bookingId), true);
    assert.equal(await uses(cy), 0);
});

await check('a booking that fails gives the claim back', async () => {
    const r = await couponService.validateCoupon({ code: 'HOME100', userId: String(di.spId), amount: 800 });
    assert.equal(await couponService.claimCoupon(r.coupon), true);
    await couponService.unclaimCoupon(r.coupon);
    assert.equal(await uses(di), 0);
});

await check('used on Food by the same person, Services refuses it', async () => {
    assert.equal((await core.claimPlatformCoupon('HOME100', { service: 'food', platformUserId: di.platformId })).taken, true);
    await assert.rejects(couponService.validateCoupon({ code: 'HOME100', userId: String(di.spId), amount: 800 }), /already used/);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Services platform coupon checks passed');
process.exit(0);
