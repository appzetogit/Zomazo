/**
 * Quick and the Shop bill with ONE copy of the delivery and tax maths
 * (core/pricing/deliveryMath.js), carrying the fixes each copy had.
 *
 * Run: node tests/shared-delivery-math.smoke.mjs
 */
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const core = await import('../src/core/pricing/deliveryMath.js');
const quick = await import('../src/modules/quickCommerce/modules/food/orders/services/order-pricing.service.js');
const shop = await import('../src/modules/ecommerce/modules/commerce/orders/services/order-pricing.service.js');

for (const name of ['computeDeliveryFeeGst', 'computeItemsTax', 'resolveUserDeliveryFee', 'calculateRiderEarning']) {
    assert.equal(quick[name], core[name], `Quick's ${name} is the shared one`);
    assert.equal(shop[name], core[name], `the Shop's ${name} is the shared one`);
}

const bands = [
    { min: 0, max: 3, fee: 20, deliveryBoyBasePay: 25 },
    { min: 3, max: 7, fee: 35, deliveryBoyPerKm: 8 },
    { min: 7, max: 15, fee: 50, deliveryBoyBasePay: 60, extraPerKm: 4 },
];

// GST to the paisa (the Shop charged 5 for 5.25).
assert.equal(core.computeItemsTax([{ price: 105, quantity: 1, gstRate: 5 }], { subtotal: 105 }), 5.25);
assert.equal(core.computeItemsTax([{ price: 105, quantity: 3, gstRate: 5 }], { subtotal: 315 }), 15.75);
// A platform-funded coupon leaves the taxable value whole.
assert.equal(core.computeItemsTax([{ price: 100, gstRate: 18 }], { subtotal: 100, discount: 50, discountFundedByPlatform: true }), 18);
assert.equal(core.computeItemsTax([{ price: 100, gstRate: 18 }], { subtotal: 100, discount: 50 }), 9);

// An unknown distance pays the shortest band, never a 0 km trip (Quick paid 0).
for (const unknown of [null, undefined, '']) {
    assert.equal(core.calculateRiderEarning({ deliveryFeeRanges: bands }, unknown), 25, String(unknown));
}
// A band's per-km extra is charged and paid beyond its start.
assert.equal(core.resolveUserDeliveryFee({ deliveryFeeRanges: bands }, { distanceKm: 12 }).deliveryFee, 70);
assert.equal(core.calculateRiderEarning({ deliveryFeeRanges: bands }, 12), 80);
// Past the last band: the widest band, not 0.
assert.equal(core.calculateRiderEarning({ deliveryFeeRanges: bands.slice(0, 2) }, 20), 160);
assert.equal(core.computeDeliveryFeeGst(33.33), 6);

console.log('All shared delivery maths checks passed');
process.exit(0);
