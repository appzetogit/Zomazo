/**
 * Bank payouts through RazorpayX: off by default, paid once, and a failed
 * transfer gives the money back once.
 *
 * Run: node tests/bank-payouts.smoke.mjs
 *
 * Every RazorpayX call goes to a fake transport (__setPayoutTransport); this
 * test never reaches the real API. The webhook is driven through a small
 * express app with the same raw-body capture app.js uses.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};
const rejects = async (p, code) => {
    try { await p; } catch (err) { assert.equal(err.statusCode, code, err.message); return err; }
    throw new Error(`expected a ${code} refusal`);
};

const main = async () => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'bank_payouts' });

    const { config } = await import('../src/config/env.js');
    const client = await import('../src/core/payouts/razorpayx.client.js');
    const payouts = await import('../src/core/payouts/payout.service.js');
    const { default: payoutRoutes } = await import('../src/core/payouts/payout.routes.js');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
    const { FoodRestaurantWithdrawal } = await import('../src/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js');
    const { FoodDeliveryWithdrawal } = await import('../src/modules/food/delivery/models/foodDeliveryWithdrawal.model.js');
    const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodDeliveryWallet } = await import('../src/modules/food/delivery/models/deliveryWallet.model.js');
    const { PayoutAccount } = await import('../src/core/payouts/payoutAccount.model.js');
    const admin = await import('../src/modules/food/admin/services/admin.service.js');

    // Transactions cannot create collections.
    for (const M of [FoodRestaurantWithdrawal, FoodDeliveryWithdrawal, FoodDeliveryWallet, PayoutAccount]) {
        await M.createCollection().catch(() => {});
    }

    // Fake RazorpayX. A repeated idempotency key returns the same payout, as the real one does.
    const calls = [];
    const byKey = new Map();
    let seq = 0;
    client.__setPayoutTransport(async ({ method, path, data, headers }) => {
        calls.push({ method, path, data, headers });
        if (path === '/contacts') return { status: 200, data: { id: `cont_${++seq}` } };
        if (path === '/fund_accounts') return { status: 200, data: { id: `fa_${++seq}` } };
        if (path === '/payouts' && method === 'POST') {
            const key = headers['X-Payout-Idempotency'];
            if (!byKey.has(key)) byKey.set(key, { id: `pout_${++seq}`, status: 'processing', notes: data.notes });
            return { status: 200, data: byKey.get(key) };
        }
        return { status: 404, data: { error: { description: 'not found' } } };
    });
    const payoutPosts = () => calls.filter((c) => c.path === '/payouts' && c.method === 'POST').length;

    const restaurantWithdrawal = async (account = '1234567890') => {
        const rid = new mongoose.Types.ObjectId();
        await FoodRestaurant.collection.insertOne({
            _id: rid, restaurantName: 'Test Kitchen', ownerName: 'Owner', ownerPhone: '9999999999', status: 'approved',
            accountNumber: account, ifscCode: 'HDFC0000001', accountHolderName: 'Owner',
            location: { type: 'Point', coordinates: [76.53, 32.1] }, createdAt: new Date(),
        });
        await FoodTransaction.collection.insertOne({
            _id: new mongoose.Types.ObjectId(), orderId: new mongoose.Types.ObjectId(), restaurantId: rid,
            status: 'captured', amounts: { restaurantShare: 1000 }, createdAt: new Date(),
        });
        const w = await FoodRestaurantWithdrawal.create({ restaurantId: rid, amount: 500, status: 'pending' });
        await admin.updateWithdrawalStatus(String(w._id), { status: 'approved' });
        return { rid, id: w._id };
    };

    // Webhook app, raw body kept as app.js does.
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { if (req.originalUrl.includes('/webhook/razorpay')) req.rawBody = buf; } }));
    app.use('/api/v1/payouts', payoutRoutes);
    const server = app.listen(0);
    const url = `http://127.0.0.1:${server.address().port}/api/v1/payouts/webhook/razorpayx`;
    const hook = async (event, entity, { secret = 'whsec_test' } = {}) => {
        const body = JSON.stringify({ event, payload: { payout: { entity } } });
        const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body });
        return res.status;
    };

    console.log('\nnot configured: manual stays as it is');
    Object.assign(config, { razorpayxKeyId: '', razorpayxKeySecret: '', razorpayxAccountNumber: '', razorpayxWebhookSecret: '' });
    const manual = await restaurantWithdrawal();
    await check('approval works exactly as before, no payout fields', async () => {
        const row = await FoodRestaurantWithdrawal.findById(manual.id).lean();
        assert.equal(row.status, 'approved');
        assert.equal(row.payout, undefined);
    });
    await check('Pay via bank is refused, nothing is called', async () => {
        await rejects(payouts.initiatePayout('food_restaurant', manual.id), 400);
        assert.equal(calls.length, 0);
    });
    await check('manual reference can still be recorded', async () => {
        const row = await admin.updateWithdrawalStatus(String(manual.id), { status: 'approved', transactionId: 'NEFT123' });
        assert.equal(row.transactionId, 'NEFT123');
    });

    Object.assign(config, {
        razorpayxKeyId: 'rzp_test_x', razorpayxKeySecret: 'secret', razorpayxAccountNumber: '7878780080316316', razorpayxWebhookSecret: 'whsec_test',
    });

    console.log('\ndouble click pays once');
    const r1 = await restaurantWithdrawal();
    const both = await Promise.allSettled([
        payouts.initiatePayout('food_restaurant', r1.id), payouts.initiatePayout('food_restaurant', r1.id),
    ]);
    await check('one succeeds, one is refused', async () => {
        assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(both.find((r) => r.status === 'rejected').reason.statusCode, 409);
    });
    await check('exactly one payout created, IMPS, keyed by the withdrawal id', async () => {
        assert.equal(payoutPosts(), 1);
        const post = calls.find((c) => c.path === '/payouts');
        assert.equal(post.headers['X-Payout-Idempotency'], `${r1.id}-1`);
        assert.equal(post.data.mode, 'IMPS');
        assert.equal(post.data.amount, 50000);
    });
    const row1 = await FoodRestaurantWithdrawal.findById(r1.id).lean();
    await check('row shows processing with the payout id', async () => {
        assert.equal(row1.payout.state, 'processing');
        assert.ok(row1.payout.payoutId);
    });
    await check('a third click is refused', async () => {
        await rejects(payouts.initiatePayout('food_restaurant', r1.id), 409);
        assert.equal(payoutPosts(), 1);
    });

    console.log('\nwebhooks');
    await check('a bad signature is refused and changes nothing', async () => {
        const status = await hook('payout.processed', { id: row1.payout.payoutId, status: 'processed', utr: 'UTR1', notes: { kind: 'food_restaurant', recordId: String(r1.id) } }, { secret: 'wrong' });
        assert.equal(status, 400);
        assert.equal((await FoodRestaurantWithdrawal.findById(r1.id).lean()).payout.state, 'processing');
    });
    await check('payout.processed marks it paid with the UTR', async () => {
        const status = await hook('payout.processed', { id: row1.payout.payoutId, status: 'processed', utr: 'UTR1', notes: { kind: 'food_restaurant', recordId: String(r1.id) } });
        assert.equal(status, 200);
        const row = await FoodRestaurantWithdrawal.findById(r1.id).lean();
        assert.equal(row.payout.state, 'processed');
        assert.equal(row.payout.utr, 'UTR1');
        assert.equal(row.transactionId, 'UTR1');
        assert.equal(row.status, 'approved');
    });

    console.log('\nfailed payout returns the money once');
    const pid = new mongoose.Types.ObjectId();
    await FoodDeliveryPartner.collection.insertOne({
        _id: pid, name: 'Rider', phone: '9888888888', bankAccountNumber: '999000111', bankIfscCode: 'SBIN0000001',
        bankAccountHolderName: 'Rider', createdAt: new Date(),
    });
    // State after an approval: Rs 300 already taken from the stored wallet.
    await FoodDeliveryWallet.collection.insertOne({ deliveryPartnerId: pid, balance: 200, totalSettled: 300 });
    const rw = await FoodDeliveryWithdrawal.create({ deliveryPartnerId: pid, amount: 300, status: 'approved' });
    await payouts.initiatePayout('food_rider', rw._id);
    const rider = await FoodDeliveryWithdrawal.findById(rw._id).lean();
    const failEntity = { id: rider.payout.payoutId, status: 'failed', status_details: { description: 'Beneficiary bank down' }, notes: { kind: 'food_rider', recordId: String(rw._id) } };
    const statuses = await Promise.all([hook('payout.failed', failEntity), hook('payout.failed', failEntity)]);
    await hook('payout.reversed', { ...failEntity, status: 'reversed' });
    await check('webhooks accepted', async () => assert.deepEqual(statuses, [200, 200]));
    await check('wallet credited back exactly once', async () => {
        const w = await FoodDeliveryWallet.findOne({ deliveryPartnerId: pid }).lean();
        assert.equal(w.balance, 500);
        assert.equal(w.totalSettled, 0);
    });
    await check('request reopened as pending, payout failed with the reason', async () => {
        const row = await FoodDeliveryWithdrawal.findById(rw._id).lean();
        assert.equal(row.status, 'pending');
        assert.equal(row.payout.state, 'failed');
        assert.match(row.payout.failureReason, /bank down/);
    });
    await check('retry after re-approval sends a NEW payout (attempt 2)', async () => {
        await FoodDeliveryWithdrawal.updateOne({ _id: rw._id }, { $set: { status: 'approved' } });
        const before = payoutPosts();
        await payouts.initiatePayout('food_rider', rw._id);
        const row = await FoodDeliveryWithdrawal.findById(rw._id).lean();
        assert.equal(payoutPosts(), before + 1);
        assert.equal(row.payout.attempt, 2);
        assert.equal(calls.at(-1).headers['X-Payout-Idempotency'], `${rw._id}-2`);
    });

    console.log('\nbank details changed in the last 24 hours');
    const pid2 = new mongoose.Types.ObjectId();
    await FoodDeliveryPartner.collection.insertOne({
        _id: pid2, name: 'Rider 2', phone: '9777777777', bankAccountNumber: '5550001', bankIfscCode: 'SBIN0000001',
        bankDetailsChangedAt: new Date(Date.now() - 2 * 3600 * 1000), createdAt: new Date(),
    });
    const held = await FoodDeliveryWithdrawal.create({ deliveryPartnerId: pid2, amount: 100, status: 'approved' });
    await check('rider with a fresh change is held, nothing is called', async () => {
        const before = calls.length;
        await rejects(payouts.initiatePayout('food_rider', held._id), 409);
        assert.equal(calls.length, before);
        assert.equal((await FoodDeliveryWithdrawal.findById(held._id).lean()).payout, undefined);
    });
    await check('restaurant whose account changed since its last payout is held', async () => {
        const r2 = await restaurantWithdrawal();
        await payouts.initiatePayout('food_restaurant', r2.id);
        await FoodRestaurant.updateOne({ _id: r2.rid }, { $set: { accountNumber: '000999888' } });
        const w = await FoodRestaurantWithdrawal.create({ restaurantId: r2.rid, amount: 100, status: 'approved' });
        await rejects(payouts.initiatePayout('food_restaurant', w._id), 409);
    });

    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error(err); process.exit(1); });
