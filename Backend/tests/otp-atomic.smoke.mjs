// OTP verification must count every guess and let a code sign in exactly once.
//
// Before: a guess read the row, compared, then saved attempts fire-and-forget, so
// twenty parallel guesses all saw attempts=0. A correct code was deleted in the
// background, so a second request with the same code could also succeed. And a
// row with no scope matched any scope.
//
// Run: NODE_ENV=test MONGOMS_VERSION=7.0.24 node tests/otp-atomic.smoke.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
process.env.OTP_MAX_ATTEMPTS = '5';
process.env.OTP_RATE_LIMIT = '1000';
delete process.env.USE_DEFAULT_OTP;

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri());

const { config } = await import('../src/config/env.js');
// Dev bypasses only key off these numbers; keep the test phones clear of them.
config.useDefaultOtp = false;
const { createOrUpdateOtp, verifyOtp } = await import('../src/core/otp/otp.service.js');
const { FoodOtp } = await import('../src/core/otp/otp.model.js');

// No SMS gateway in tests: the send fails fast and is swallowed.
config.smsIndiaHubUrl = 'http://127.0.0.1:9/';

const wrongFor = (code) => (code === '1111' ? '2222' : '1111');

console.log('\n[1] the code is not stored in plain text');
{
    const code = await createOrUpdateOtp('9100000001', 'user');
    const row = await FoodOtp.findOne({ phone: '9100000001' }).lean();
    check('no plain otp on the row', () => assert.equal(row.otp, undefined));
    check('a hash and salt are stored', () => { assert.match(row.otpHash, /^[0-9a-f]{64}$/); assert.ok(row.salt); });
    check('hash is not the bare sha256 of the code', () =>
        assert.notEqual(row.otpHash, crypto.createHash('sha256').update(code).digest('hex')));
}

console.log('\n[2] twenty parallel wrong guesses are all counted');
{
    const phone = '9100000002';
    const code = await createOrUpdateOtp(phone, 'user');
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyOtp(phone, wrongFor(code), 'user')));
    const row = await FoodOtp.findOne({ phone }).lean();
    check('none succeeded', () => assert.equal(results.filter((r) => r.valid).length, 0));
    check('attempts capped at the max, not lost', () => assert.equal(row.attempts, 5));
    check('15 were refused as locked', () =>
        assert.equal(results.filter((r) => r.reason === 'Max attempts exceeded').length, 15));
    const after = await verifyOtp(phone, code, 'user');
    check('the right code is refused once locked', () => assert.equal(after.valid, false));
    let resendErr = null;
    try { await createOrUpdateOtp(phone, 'user'); } catch (e) { resendErr = e; }
    check('asking for a new code does not reset the lock', () => assert.match(String(resendErr?.message), /Too many wrong OTP attempts/));
}

console.log('\n[3] a code signs in exactly once');
{
    const phone = '9100000003';
    const code = await createOrUpdateOtp(phone, 'user');
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(phone, code, 'user')));
    check('exactly one concurrent submit succeeded', () => assert.equal(results.filter((r) => r.valid).length, 1));
    const again = await verifyOtp(phone, code, 'user');
    check('a later reuse fails', () => assert.equal(again.valid, false));
}

console.log('\n[4] scope is enforced');
{
    const phone = '9100000004';
    const code = await createOrUpdateOtp(phone, 'restaurant');
    const other = await verifyOtp(phone, code, 'user');
    check('restaurant code does not sign in a user', () => assert.equal(other.valid, false));
    const none = await verifyOtp(phone, code);
    check('missing scope is refused', () => assert.equal(none.valid, false));
    // A legacy row with no scope must not match anything.
    await FoodOtp.collection.insertOne({ phone: '9100000005', otp: '4321', expiresAt: new Date(Date.now() + 60000), attempts: 0, createdAt: new Date() });
    const legacy = await verifyOtp('9100000005', '4321', 'user');
    check('scopeless legacy row is ignored', () => assert.equal(legacy.valid, false));
    const ok = await verifyOtp(phone, code, 'restaurant');
    check('the right scope still works', () => assert.equal(ok.valid, true));
}

console.log('\n[5] 6-digit codes when OTP_LENGTH=6');
{
    config.otpLength = 6;
    const code = await createOrUpdateOtp('9100000006', 'user');
    check('six digits', () => assert.match(code, /^\d{6}$/));
    const ok = await verifyOtp('9100000006', code, 'user');
    check('and it verifies', () => assert.equal(ok.valid, true));
    config.otpLength = 4;
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures}`}\n`);
process.exit(failures ? 1 : 0);
