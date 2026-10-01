/**
 * Rewards taken back on admin refunds, and paid on Services bookings and
 * Services wallet top-ups.
 *
 *   - every admin refund (core/orders/adminRefundClaim.js) takes back its share
 *     of the order's cashback and points, once per refund; a full refund takes
 *     back the rest and never more than was given -- also when the refund is
 *     recorded by a takeover of a stale claim;
 *   - a Services booking pays cashback and points when it completes, only once
 *     the completing transaction has committed, and not when it rolls back;
 *   - a Services top-up gets the wallet bonus once.
 *
 * Run: NODE_ENV=test MONGOMS_VERSION=7.0.24 node tests/platform-rewards-refunds.smoke.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(48).toString('hex');

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
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(repl.getUri('platform_rewards_refunds'));

const { CashbackOfferUse } = await import('../src/core/promotions/rewards.model.js');
const { LoyaltyLedger, LoyaltyAccount } = await import('../src/core/loyalty/loyalty.model.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const admin = await import('../src/core/promotions/rewardsAdmin.service.js');
const loyalty = await import('../src/core/loyalty/loyalty.service.js');
const { runAdminRefund } = await import('../src/core/orders/adminRefundClaim.js');
const foodCashback = await import('../src/modules/food/user/services/cashback.service.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const require = createRequire(import.meta.url);
const SPBooking = require('../src/modules/serviceProvider/models/Booking.js');
const spRewards = require('../src/modules/serviceProvider/services/platformRewards.js');

// Transactions cannot create collections: make them first.
for (const name of ['food_user_wallets', 'sp_bookings', 'sp_users', 'users', 'food_orders', 'platform_loyalty_ledger', 'platform_loyalty_accounts', 'platform_cashback_offer_uses']) {
    await mongoose.connection.db.createCollection(name).catch(() => {});
}
await Promise.all([CashbackOfferUse.syncIndexes(), LoyaltyLedger.syncIndexes(), LoyaltyAccount.syncIndexes(), CustomerWallet.syncIndexes()]);

const owner = { _id: new mongoose.Types.ObjectId(), role: 'superadmin' };
await admin.createCashbackOffer(owner, { title: 'Food 10%', services: ['food'], cashbackType: 'percentage', cashbackValue: 10 });
await admin.createCashbackOffer(owner, { title: 'Services flat 50', services: ['serviceProvider'], cashbackType: 'flat', cashbackValue: 50 });
await admin.createWalletBonus(owner, { title: 'Add 500 get 25', bonusType: 'flat', bonusValue: 25, minTopup: 500 });
await admin.writeLoyaltySettings(owner, { isEnabled: true, pointsPerHundred: 10, pointsPerRupee: 10, minConvertPoints: 10 });

const balance = async (userId) => Number((await CustomerWallet.findOne({ userId }).lean())?.balance || 0);
const rows = async (userId, source) =>
    ((await CustomerWallet.findOne({ userId }).lean())?.transactions || []).filter((t) => t?.metadata?.source === source);

const PATHS = { status: 'payment.refund.status', counter: 'payment.refund.refundedPaise', claim: 'payment.refund.claim', history: 'payment.refund.history' };

// A delivered Rs 400 Food order that earned Rs 40 cashback and 40 points.
async function deliveredFoodOrder(userId) {
    const _id = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({ _id, order_id: `F${String(_id).slice(-5)}`, userId, orderStatus: 'delivered', pricing: { subtotal: 400, total: 400 }, payment: { refund: {} } });
    await foodCashback.awardOrderCashback(_id);
    return _id;
}
const refund = (orderId, userId, amount, extra = {}) => runAdminRefund({
    Model: FoodOrder,
    docId: orderId,
    paths: PATHS,
    paidPaise: 40000,
    amount,
    meta: { method: 'wallet', reason: 'test', byAdminId: '' },
    rewards: { service: 'food', customerId: userId, orderId },
    pay: async () => ({ refundId: 'rf_test' }),
    findPaid: async () => null,
    ...extra,
});

await check('admin refund: a quarter refunded takes back a quarter, the full rest takes back the rest, never more', async () => {
    const ana = new mongoose.Types.ObjectId();
    const order = await deliveredFoodOrder(ana);
    assert.equal(await balance(ana), 40);
    assert.equal((await loyalty.getLoyaltySummary(ana)).balance, 40);

    await refund(order, ana, 100);
    assert.equal(await balance(ana), 30);
    assert.equal((await loyalty.getLoyaltySummary(ana)).balance, 30);

    await refund(order, ana, undefined); // everything left: Rs 300
    assert.equal(await balance(ana), 0);
    assert.equal((await loyalty.getLoyaltySummary(ana)).balance, 0);
    const back = (await rows(ana, 'cashback_reversal')).reduce((n, t) => n + t.amount, 0);
    assert.equal(back, 40);
    await assert.rejects(refund(order, ana, 1), /already been refunded/);
});

await check('admin refund: the same refund recorded twice (stale-claim takeover) takes back once', async () => {
    const ben = new mongoose.Types.ObjectId();
    const order = await deliveredFoodOrder(ben);
    // A claim a crash left 'pending' 20 minutes ago, whose payout did go out.
    const key = 'rf_crashed';
    await FoodOrder.collection.updateOne({ _id: order }, {
        $set: {
            'payment.refund.status': 'pending',
            'payment.refund.refundedPaise': 20000,
            'payment.refund.claim': { key, at: new Date(Date.now() - 20 * 60 * 1000), amountPaise: 20000, prevStatus: 'none' },
        },
    });
    const { takeBackForRefund } = await import('../src/core/promotions/orderRewards.js');
    const r = await refund(order, ben, 100, { findPaid: async (c) => (c.key === key ? { refundId: 'rf_found' } : null) });
    assert.equal(r.recovered.outcome, 'recorded');
    // The crashed half (Rs 200) and the new Rs 100: 20 + 10 back of 40.
    assert.equal(await balance(ben), 10);
    // Recording the crashed claim again changes nothing.
    await takeBackForRefund({ service: 'food', customerId: ben, orderId: order, refundedPaise: 20000, paidPaise: 40000, key: `admin_refund:${key}` });
    assert.equal(await balance(ben), 10);
    assert.equal((await loyalty.getLoyaltySummary(ben)).balance, 10);
});

await check('points already converted stay converted; a refund only takes what is left', async () => {
    const cy = new mongoose.Types.ObjectId();
    const order = await deliveredFoodOrder(cy);
    await loyalty.convertPoints(cy, 30); // 40 points -> 10 left
    await refund(order, cy, undefined);
    assert.equal((await loyalty.getLoyaltySummary(cy)).balance, 0);
    assert.equal((await loyalty.getLoyaltySummary(cy)).converted, 30);
});

// A Services customer with a platform account.
const platformUser = new mongoose.Types.ObjectId();
const spUser = new mongoose.Types.ObjectId();
await mongoose.connection.collection('users').insertOne({ _id: platformUser, phone: '9000000001', name: 'Dev' });
await mongoose.connection.collection('sp_users').insertOne({ _id: spUser, phone: '9000000001', platformUserId: platformUser });

const newBooking = async (userId) => {
    const _id = new mongoose.Types.ObjectId();
    await SPBooking.collection.insertOne({ _id, bookingNumber: `BK${String(_id).slice(-8)}`, userId, status: 'work_done', finalAmount: 600 });
    return SPBooking.findById(_id);
};

await check('Services: a booking completed inside a transaction pays after commit, once', async () => {
    const booking = await newBooking(spUser);
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
        booking.status = 'completed';
        await booking.save({ session, validateBeforeSave: false });
        await settle(200);
        assert.equal(await balance(platformUser), 0, 'paid before the commit');
    });
    await session.endSession();
    await settle();
    assert.equal(await balance(platformUser), 50);
    assert.equal((await loyalty.getLoyaltySummary(platformUser)).balance, 60);
    // Saving the completed booking again pays nothing more.
    booking.workerNotes = 'done';
    await booking.save({ validateBeforeSave: false });
    await spRewards.rewardCompletedBooking(booking.toObject());
    await settle();
    assert.equal(await balance(platformUser), 50);
});

await check('Services: a completion that rolls back pays nothing', async () => {
    const before = await balance(platformUser);
    const booking = await newBooking(spUser);
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
        booking.status = 'completed';
        await booking.save({ session, validateBeforeSave: false });
        await session.abortTransaction();
    }).catch(() => {});
    await session.endSession();
    await settle();
    assert.equal(await balance(platformUser), before);
});

await check('Services: a customer with no platform account is skipped', async () => {
    const loner = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('sp_users').insertOne({ _id: loner, phone: '9000000099' });
    assert.equal(await spRewards.rewardCompletedBooking({ _id: new mongoose.Types.ObjectId(), userId: loner, status: 'completed', finalAmount: 600 }), null);
    assert.equal(await spRewards.applyTopupBonus({ customerId: loner, topupAmount: 1000, reference: 'order_loner' }), 0);
});

await check('Services: a top-up gets the wallet bonus once per Razorpay order', async () => {
    const before = await balance(platformUser);
    assert.equal(await spRewards.applyTopupBonus({ customerId: spUser, topupAmount: 800, reference: 'order_sp_1' }), 25);
    assert.equal(await spRewards.applyTopupBonus({ customerId: spUser, topupAmount: 800, reference: 'order_sp_1' }), 0);
    assert.equal(await balance(platformUser), before + 25);
});

await mongoose.disconnect();
await repl.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
