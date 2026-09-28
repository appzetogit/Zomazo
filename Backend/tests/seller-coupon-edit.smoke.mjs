/**
 * Restaurant / QC seller coupon edit.
 *
 * Run: node tests/seller-coupon-edit.smoke.mjs
 *
 * What this guards:
 *   - editing a coupon updates it in place (no duplicate row) on Food and Quick;
 *   - only the owning outlet can edit; admin coupons and other outlets' are "not found";
 *   - a code taken by another coupon is refused, keeping one's own code is fine;
 *   - the usage limit cannot drop below redemptions already made, and usedCount is kept;
 *   - the status toggle flips active/inactive.
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

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
await mongoose.connect(process.env.MONGO_URI);

const { validateCreateOfferDto } = await import('../src/modules/food/admin/validators/offer.validator.js');
const food = await import('../src/modules/food/restaurant/services/restaurant.service.js');
const quick = await import('../src/modules/quickCommerce/modules/food/restaurant/services/restaurant.service.js');
const { FoodOffer } = await import('../src/modules/food/admin/models/offer.model.js');
const { FoodOffer: QuickOffer } = await import('../src/modules/quickCommerce/modules/food/admin/models/offer.model.js');

const oid = () => new mongoose.Types.ObjectId();
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const dto = (restaurantId, over = {}) => validateCreateOfferDto({
  couponCode: 'SAVE10', discountType: 'percentage', discountValue: 10, maxDiscount: 50,
  minOrderValue: 100, startDate: inDays(0), endDate: inDays(10), restaurantScope: 'selected',
  restaurantId: String(restaurantId), ...over,
});

for (const [name, svc, Model] of [['food', food, FoodOffer], ['quick', quick, QuickOffer]]) {
  console.log(`\n${name}`);
  const mine = oid();
  const other = oid();
  const created = await svc.createRestaurantOffer(String(mine), dto(mine, { couponCode: `${name}A` }));
  await svc.createRestaurantOffer(String(other), dto(other, { couponCode: `${name}B` }));
  const adminOffer = await Model.create({ couponCode: `${name}ADMIN`, discountType: 'flat-price', discountValue: 20, restaurantScope: 'selected', restaurantId: mine, createdByRole: 'ADMIN' });

  await check('edit updates in place', async () => {
    const before = await Model.countDocuments();
    const doc = await svc.updateRestaurantOffer(String(mine), String(created._id),
      dto(mine, { couponCode: `${name}A`, discountType: 'flat-price', discountValue: 75, minOrderValue: 300, usageLimit: 20 }));
    assert.equal(await Model.countDocuments(), before);
    assert.equal(doc.discountType, 'flat-price');
    assert.equal(doc.discountValue, 75);
    assert.equal(doc.minOrderValue, 300);
    assert.equal(doc.maxDiscount, null);
    assert.equal(doc.usageLimit, 20);
  });

  await check('code can be renamed, not to a taken one', async () => {
    const doc = await svc.updateRestaurantOffer(String(mine), String(created._id), dto(mine, { couponCode: `${name}new` }));
    assert.equal(doc.couponCode, `${name.toUpperCase()}NEW`);
    await assert.rejects(() => svc.updateRestaurantOffer(String(mine), String(created._id), dto(mine, { couponCode: `${name}B` })), /already exists/);
  });

  await check('another outlet or an admin coupon cannot be edited', async () => {
    await assert.rejects(() => svc.updateRestaurantOffer(String(other), String(created._id), dto(other, { couponCode: 'X1' })), /not owned/);
    await assert.rejects(() => svc.updateRestaurantOffer(String(mine), String(adminOffer._id), dto(mine, { couponCode: 'X2' })), /not owned/);
    await assert.rejects(() => svc.updateRestaurantOffer(String(mine), 'nope', dto(mine, { couponCode: 'X3' })), /not owned/);
  });

  await check('usage limit keeps redemptions already made', async () => {
    await Model.updateOne({ _id: created._id }, { $set: { usedCount: 5 } });
    await assert.rejects(() => svc.updateRestaurantOffer(String(mine), String(created._id), dto(mine, { couponCode: `${name}NEW`, usageLimit: 3 })), /below the 5/);
    const doc = await svc.updateRestaurantOffer(String(mine), String(created._id), dto(mine, { couponCode: `${name}NEW`, usageLimit: 8 }));
    assert.equal(doc.usedCount, 5);
  });

  await check('status toggle', async () => {
    const off = await svc.updateRestaurantOfferStatus(String(mine), String(created._id), 'inactive');
    assert.equal(off.status, 'inactive');
    const on = await svc.updateRestaurantOfferStatus(String(mine), String(created._id), 'active');
    assert.equal(on.status, 'active');
  });
}

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll seller coupon edit checks passed');
process.exit(failed ? 1 : 0);
