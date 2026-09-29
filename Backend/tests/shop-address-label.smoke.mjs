/**
 * A Shop order or saved address with a label the app made up ("Current
 * Location", "home") is accepted and mapped, not refused.
 *
 * Run: node tests/shop-address-label.smoke.mjs
 */
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { validateCreateOrderDto } = await import('../src/modules/ecommerce/modules/commerce/orders/validators/order.validator.js');
const { validateCreateAddressDto } = await import('../src/modules/ecommerce/modules/commerce/user/validators/userAddress.validator.js');

let failed = 0;
const check = (label, fn) => {
    try { fn(); console.log(`  PASS  ${label}`); }
    catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const order = (label) => ({
    items: [{ itemId: 'x', name: 'Soap', price: 10, quantity: 1 }],
    address: { label, street: '1 Main St', city: 'Pune', state: 'MH', phone: '9999999999' },
    sellerId: 's1',
    pricing: { subtotal: 10, total: 10 },
    paymentMethod: 'razorpay',
});
const address = (label) => ({ label, street: '1 Main St', city: 'Pune', state: 'MH', latitude: 18.5, longitude: 73.8 });

check('an order addressed to "Current Location" is accepted as Other', () => {
    assert.equal(validateCreateOrderDto(order('Current Location')).address.label, 'Other');
});

check('lower-case and "work" labels map onto Home and Office', () => {
    assert.equal(validateCreateOrderDto(order('home')).address.label, 'Home');
    assert.equal(validateCreateAddressDto(address('work')).label, 'Office');
});

check('a saved address with an unknown label becomes Other', () => {
    assert.equal(validateCreateAddressDto(address('Current Location')).label, 'Other');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
