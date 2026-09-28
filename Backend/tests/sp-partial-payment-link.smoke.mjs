/**
 * A Services payment link counts as paid only when it is fully paid.
 *
 * Run: node tests/sp-partial-payment-link.smoke.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { paymentLinkPayments } = require('../src/modules/serviceProvider/services/razorpayService.js');

assert.deepEqual(paymentLinkPayments({ status: 'partially_paid', amount: 200000, amount_paid: 100 }), []);
assert.deepEqual(paymentLinkPayments({ status: 'created' }), []);
assert.deepEqual(paymentLinkPayments(null), []);
const [paid] = paymentLinkPayments({ status: 'paid', razorpay_payment_id: 'pay_1', amount_paid: 200000 });
assert.equal(paid.status, 'captured');
assert.equal(paid.id, 'pay_1');
console.log('All Services payment-link checks passed');
