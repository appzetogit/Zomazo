/**
 * Wallet top-up holes across services, on the customer's ONE wallet.
 *
 * Run: node tests/wallet-topup-holes.smoke.mjs
 *
 * What this guards:
 *   - Quick's top-up no longer credits the amount the caller sends: a correctly
 *     signed payment claiming Rs 100000 is checked with the gateway, and
 *     nothing is credited when it cannot be confirmed;
 *   - Quick refuses outright when no gateway is configured (it used to credit);
 *   - Rides credits one payment once, to one wallet: never a second account,
 *     never twice when two verifies arrive together;
 *   - a PhonePe top-up id belonging to another customer is refused;
 *   - Rides adds its rows at the front and never trims the shared history,
 *     and its screen lists the newest by date, however the rows were stored.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_fake';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_for_signatures';

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
process.env.MONGODB_URI = mongo.getUri('wallet_topup_holes');
await mongoose.connect(mongo.getUri('wallet_topup_holes'));
const db = mongoose.connection;

const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const quickWallet = await import('../src/modules/quickCommerce/modules/food/user/services/userWallet.service.js');
const taxi = await import('../src/modules/taxi/user/controllers/userController.js');
const { creditTopupOnce, buildUserWalletPayload } = taxi.__testables;

const oid = () => new mongoose.Types.ObjectId();
const sign = (orderId, paymentId) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const balanceOf = async (userId) => (await CustomerWallet.findOne({ userId }).lean())?.balance ?? 0;

const platformId = oid();
const qcId = oid();
await db.collection('users').insertOne({ _id: platformId, phone: '9000000001' });
await db.collection('qc_users').insertOne({ _id: qcId, phone: '9000000001', platformUserId: platformId });

await check('Quick: a signed Rs 1 payment claiming Rs 100000 credits nothing unconfirmed', async () => {
    const orderId = 'order_attack1';
    const paymentId = 'pay_attack1';
    await assert.rejects(
        quickWallet.verifyWalletTopupPayment(String(qcId), {
            razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sign(orderId, paymentId), amount: 100000,
        }),
        /verify payment with gateway|order mismatch|not captured|amount missing/i,
    );
    assert.equal(await balanceOf(platformId), 0);
});

await check('Quick: with no gateway configured it refuses, rather than crediting', async () => {
    const saved = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
        await assert.rejects(
            quickWallet.verifyWalletTopupPayment(String(qcId), {
                razorpayOrderId: 'o2', razorpayPaymentId: 'p2', razorpaySignature: 'x', amount: 500,
            }),
            /not configured/i,
        );
        assert.equal(await balanceOf(platformId), 0);
    } finally {
        [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET] = saved;
    }
});

const riderA = oid();
const riderB = oid();
await CustomerWallet.create({ userId: riderA, balance: 0 });
await CustomerWallet.create({ userId: riderB, balance: 0 });
const tx = (id) => ({ kind: 'credit', amount: 200, title: 'Wallet Refilled', provider: 'razorpay', providerOrderId: `order_${id}`, providerPaymentId: `pay_${id}` });

await check('Rides: one payment credits one wallet once', async () => {
    assert.equal(await creditTopupOnce(riderA, tx('one'), 200), true);
    assert.equal(await creditTopupOnce(riderA, tx('one'), 200), false);
    assert.equal(await balanceOf(riderA), 200);
});

await check('Rides: the same payment is refused for a second account', async () => {
    await assert.rejects(creditTopupOnce(riderB, tx('one'), 200), /another wallet/);
    assert.equal(await balanceOf(riderB), 0);
});

await check('Rides: two verifies arriving together credit once', async () => {
    const results = await Promise.allSettled([creditTopupOnce(riderA, tx('race'), 200), creditTopupOnce(riderA, tx('race'), 200)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value === true).length, 1);
    assert.equal(await balanceOf(riderA), 400);
});

await check("Rides: a PhonePe top-up id from another account is refused before PhonePe is asked", async () => {
    const other = String(oid());
    const foreignId = `UWAL${Date.now()}${other.slice(-8)}`;
    const res = { status() { return this; }, json() { return this; } };
    await assert.rejects(
        taxi.verifyPhonePeWalletTopup({ params: { merchantTransactionId: foreignId }, query: {}, auth: { sub: String(riderA) } }, res),
        /another account/,
    );
});

await check('Rides keeps the shared history: rows added at the front, nothing trimmed', async () => {
    const heavy = oid();
    const old = Array.from({ length: 60 }, (_, i) => ({ type: 'addition', kind: 'credit', amount: 1, description: `food ${i}`, createdAt: new Date(Date.now() - (i + 1) * 60000) }));
    await CustomerWallet.create({ userId: heavy, balance: 60, transactions: old });
    await creditTopupOnce(heavy, tx('heavy'), 200);
    const w = await CustomerWallet.findOne({ userId: heavy }).lean();
    assert.equal(w.transactions.length, 61);
    assert.equal(w.transactions[0].providerPaymentId, 'pay_heavy');
    assert.ok(w.transactions[0].createdAt, 'an atomically added row carries its date, which the screen sorts by');
    assert.equal(w.transactions.filter((t) => String(t.description).startsWith('food ')).length, 60);
});

await check("Rides' screen lists the newest ten by date, whatever order they were stored in", async () => {
    const t = (min, title) => ({ title, createdAt: new Date(Date.now() - min * 60000), amount: 1 });
    const payload = buildUserWalletPayload({ balance: 1, transactions: [t(5, 'b'), t(50, 'old'), t(1, 'newest'), t(20, 'c')] });
    assert.deepEqual(payload.recentTransactions.map((r) => r.title), ['newest', 'b', 'c', 'old']);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll wallet top-up checks passed');
