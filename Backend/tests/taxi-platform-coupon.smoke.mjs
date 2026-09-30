/**
 * Rides honours a platform coupon: quoted like a Taxi promo, and claimed inside
 * the booking's transaction -- an aborted booking keeps no claim.
 *
 * Run: node tests/taxi-platform-coupon.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

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

const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(repl.getUri('taxi_platform_coupon'));

const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
const promos = await import('../src/modules/taxi/services/promoService.js');
// Collections a transaction touches must exist first (they do in production;
// creating one inside a transaction contends for its lock).
const { PromoCode } = await import('../src/modules/taxi/admin/promotions/models/PromoCode.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
for (const M of [PlatformCoupon, PlatformCouponUse, PromoCode, Ride]) {
    await M.createCollection().catch(() => {});
    await M.init();
}

const rider = new mongoose.Types.ObjectId();
const location = String(new mongoose.Types.ObjectId());
await PlatformCoupon.create({ code: 'RIDE40', services: ['taxi', 'food'], discountType: 'percentage', discountValue: 20, maxDiscount: 40, perUserLimit: 1 });
const uses = async () => (await PlatformCouponUse.findOne({ platformUserId: rider }).lean())?.count || 0;
const fakeRide = () => ({ _id: new mongoose.Types.ObjectId(), fare: 300, save: async () => {} });

await check('quoted like a Taxi promo (20% of Rs 300, capped at Rs 40)', async () => {
    const r = await promos.validatePromoForContext({ code: 'ride40', userId: String(rider), fare: 300, service_location_id: location });
    assert.equal(r.eligible, true, JSON.stringify(r));
    assert.equal(r.breakdown.discount_amount, 40);
    assert.equal(r.breakdown.fare_after_discount, 260);
});

await check('an aborted booking keeps no claim', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    const ride = fakeRide();
    await promos.applyPromoToRideInTransaction({ session, ride, userId: String(rider), code: 'RIDE40', fare: 300, service_location_id: location });
    assert.equal(ride.fare, 260);
    await session.abortTransaction();
    await session.endSession();
    assert.equal(await uses(), 0);
});

await check('a booking that commits uses it; the next quote is refused', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    await promos.applyPromoToRideInTransaction({ session, ride: fakeRide(), userId: String(rider), code: 'RIDE40', fare: 300, service_location_id: location });
    await session.commitTransaction();
    await session.endSession();
    assert.equal(await uses(), 1);
    const again = await promos.validatePromoForContext({ code: 'RIDE40', userId: String(rider), fare: 300, service_location_id: location });
    assert.equal(again.eligible, false);
    assert.match(again.message, /already used/);
});

await mongoose.disconnect();
await repl.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Rides platform coupon checks passed');
process.exit(0);
