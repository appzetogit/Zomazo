/**
 * Food honours a platform coupon made in Master, counts it against the
 * customer's one account, and gives it back when the order is cancelled.
 *
 * Run: node tests/food-platform-coupon.smoke.mjs
 */
import { startFoodWorld, makeChecker, near } from './food-order-fixture.mjs';

const w = await startFoodWorld('food_platform_coupon');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const { PlatformCoupon, PlatformCouponUse } = await import('../src/core/promotions/platformCoupon.model.js');
    await PlatformCouponUse.syncIndexes();
    await PlatformCoupon.create({ code: 'ALL50', services: ['food', 'ecommerce'], discountType: 'flat', discountValue: 50, perUserLimit: 1 });
    await PlatformCoupon.create({ code: 'SHOPONLY', services: ['ecommerce'], discountType: 'flat', discountValue: 50 });
    const items = [w.appLine(w.dish)];
    const used = async () => (await PlatformCoupon.findOne({ code: 'ALL50' }).lean()).usedCount;

    console.log('\na platform coupon on a Food order');
    const buyer = await w.makeUser();
    const quoted = await w.quote(buyer._id, { items, couponCode: 'ALL50' });
    // Platform-funded, like an admin coupon: Rs 202 (see food-coupon-at-placement).
    check('quoted Rs 202 with Rs 50 off', near(quoted.total, 202) && near(quoted.discount, 50), `total ${quoted.total}, discount ${quoted.discount}`);
    const order = await w.saved(await w.place(buyer._id, { items, pricing: quoted, paymentMethod: 'cash' }));
    check('the order is charged Rs 202', near(order.pricing.total, 202), `charged ${order.pricing.total}`);
    check('the use is counted on the platform coupon', (await used()) === 1, `usedCount ${await used()}`);

    console.log('\nonce per customer');
    const again = await w.quote(buyer._id, { items, couponCode: 'ALL50' });
    check('a second quote for the same customer takes nothing off', near(again.discount, 0), `discount ${again.discount}`);

    console.log('\na coupon for another service');
    const other = await w.makeUser();
    const shopOnly = await w.quote(other._id, { items, couponCode: 'SHOPONLY' });
    check('a Shop-only platform coupon is not honoured on Food', near(shopOnly.discount, 0), `discount ${shopOnly.discount}`);

    console.log('\ncancelling gives the use back');
    await w.orderService.cancelOrder(String(order._id), String(buyer._id), 'changed my mind').catch((e) => { throw new Error(`cancel: ${e.message}`); });
    check('the coupon use is given back', (await used()) === 0, `usedCount ${await used()}`);
    const afterCancel = await w.quote(buyer._id, { items, couponCode: 'ALL50' });
    check('and the customer can use it again', near(afterCancel.discount, 50), `discount ${afterCancel.discount}`);

    failed = summary();
} finally {
    await w.stop();
}
process.exit(failed ? 1 : 0);
