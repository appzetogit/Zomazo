/**
 * Cashback offers, wallet bonuses and loyalty points: made once in admin, paid
 * into the customer's ONE wallet from any service, each exactly once.
 *
 * Run: NODE_ENV=test MONGOMS_VERSION=7.0.24 node tests/platform-rewards.smoke.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(48).toString('hex');
// The Shop's top-up verifies without a gateway only off production: no Razorpay here.
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

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
await mongoose.connect(mongo.getUri('platform_rewards'));

const { CashbackOffer, CashbackOfferUse, WalletBonus } = await import('../src/core/promotions/rewards.model.js');
const { LoyaltyLedger, LoyaltyAccount } = await import('../src/core/loyalty/loyalty.model.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { awardPlatformCashback } = await import('../src/core/promotions/cashback.service.js');
const { applyTopupBonus } = await import('../src/core/promotions/walletBonus.service.js');
const loyalty = await import('../src/core/loyalty/loyalty.service.js');
const admin = await import('../src/core/promotions/rewardsAdmin.service.js');
const foodCashback = await import('../src/modules/food/user/services/cashback.service.js');
const shopCashback = await import('../src/modules/ecommerce/modules/commerce/user/services/cashback.service.js');
const shopWallet = await import('../src/modules/ecommerce/modules/commerce/user/services/userWallet.service.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { Order: ShopOrder } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
await Promise.all([CashbackOfferUse.syncIndexes(), LoyaltyLedger.syncIndexes(), LoyaltyAccount.syncIndexes(), CustomerWallet.syncIndexes()]);

const owner = { _id: new mongoose.Types.ObjectId(), role: 'superadmin' };
const balance = async (userId) => Number((await CustomerWallet.findOne({ userId }).lean())?.balance || 0);
const rows = async (userId, source) =>
    ((await CustomerWallet.findOne({ userId }).lean())?.transactions || []).filter((t) => t?.metadata?.source === source);

// Orders are inserted raw: the hooks only read id, customer, status and pricing.
const foodOrder = async (userId, subtotal) => {
    const _id = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({ _id, order_id: `F${String(_id).slice(-5)}`, userId, orderStatus: 'delivered', pricing: { subtotal, total: subtotal } });
    return _id;
};
const shopOrder = async (userId, subtotal) => {
    const _id = new mongoose.Types.ObjectId();
    await ShopOrder.collection.insertOne({ _id, order_id: `S${String(_id).slice(-5)}`, userId, orderStatus: 'delivered', pricing: { subtotal, total: subtotal } });
    return _id;
};

await check('admin: an owner creates offers; an admin with no offers access is refused', async () => {
    await admin.createCashbackOffer(owner, {
        title: 'Food 10%', services: ['food'], cashbackType: 'percentage', cashbackValue: 10, maxCashback: 50, minOrderValue: 100, perUserLimit: 1,
    });
    await admin.createCashbackOffer(owner, { title: 'Shop flat 40', services: ['ecommerce'], cashbackType: 'flat', cashbackValue: 40 });
    const nobody = { _id: new mongoose.Types.ObjectId(), role: 'subadmin', servicesAccess: [] };
    await assert.rejects(admin.createCashbackOffer(nobody, { title: 'x', services: ['food'], cashbackType: 'flat', cashbackValue: 5 }), /offers access/);
    await assert.rejects(admin.createWalletBonus(nobody, { title: 'x', bonusType: 'flat', bonusValue: 5 }), /offers access/);
    await assert.rejects(admin.createCashbackOffer(owner, { title: 'bad', services: ['food'], cashbackType: 'percentage', cashbackValue: 150 }), /from 0 to 100/);
    assert.equal((await admin.listCashbackOffers(owner, { type: 'flat' })).items.length, 1);
});

const ana = new mongoose.Types.ObjectId();

await check('Food: a delivered order pays the offer once, however often the hook runs', async () => {
    const order = await foodOrder(ana, 300);
    const first = await foodCashback.awardOrderCashback(order);
    assert.equal(first.awarded, true);
    assert.equal(first.amount, 30);
    const again = await foodCashback.awardOrderCashback(order);
    assert.equal(again.awarded, false);
    assert.equal(await balance(ana), 30);
    const [row] = await rows(ana, 'cashback');
    assert.equal(row.metadata.orderId, String(order));
    assert.equal(row.kind, 'credit');
});

await check('the per-customer limit holds across orders', async () => {
    const r = await foodCashback.awardOrderCashback(await foodOrder(ana, 600));
    assert.equal(r.awarded, false);
    assert.equal(r.reason, 'per_user_limit_reached');
    assert.equal(await balance(ana), 30);
});

await check('a service no offer names gets no platform cashback (falls back to its own)', async () => {
    const r = await awardPlatformCashback({ service: 'taxi', customerId: ana, orderId: new mongoose.Types.ObjectId(), amount: 500 });
    assert.equal(r.reason, 'no_offer');
});

await check('a paused offer pays nothing', async () => {
    const offer = await CashbackOffer.findOne({ title: 'Shop flat 40' });
    await admin.updateCashbackOffer(owner, offer._id, { status: 'paused' });
    const r = await awardPlatformCashback({ service: 'ecommerce', customerId: ana, orderId: new mongoose.Types.ObjectId(), amount: 500 });
    assert.equal(r.reason, 'no_offer');
    await admin.updateCashbackOffer(owner, offer._id, { status: 'active' });
});

const ben = new mongoose.Types.ObjectId();

await check('two deliveries hooks at once for one order: one credit', async () => {
    const order = await shopOrder(ben, 500);
    const r = await Promise.all([shopCashback.awardOrderCashback(order), shopCashback.awardOrderCashback(order)]);
    assert.equal(r.filter((x) => x.awarded).length, 1);
    assert.equal(await balance(ben), 40);
    assert.equal((await CashbackOffer.findOne({ title: 'Shop flat 40' }).lean()).usedCount, 1);
});

await check('Shop: a return takes the cashback back pro rata, once per return', async () => {
    const [award] = await rows(ben, 'cashback');
    const orderId = award.metadata.orderId;
    const first = await shopCashback.reverseOrderCashback(orderId, { refundedAmount: 250, orderTotal: 500, key: 'return:1' });
    assert.equal(first.reversed, 20);
    const again = await shopCashback.reverseOrderCashback(orderId, { refundedAmount: 250, orderTotal: 500, key: 'return:1' });
    assert.equal(again.reversed, 0);
    assert.equal(await balance(ben), 20);
});

await check('wallet bonus: paid once per top-up, only at or over the minimum, capped', async () => {
    await admin.createWalletBonus(owner, { title: 'Add 500 get 10%', bonusType: 'percentage', bonusValue: 10, minTopup: 500, maxBonus: 75 });
    const cara = new mongoose.Types.ObjectId();
    assert.equal(await applyTopupBonus({ customerId: cara, topupAmount: 400, reference: 'order_a' }), 0);
    assert.equal(await applyTopupBonus({ customerId: cara, topupAmount: 600, reference: 'order_b' }), 60);
    assert.equal(await applyTopupBonus({ customerId: cara, topupAmount: 600, reference: 'order_b' }), 0);
    assert.equal(await applyTopupBonus({ customerId: cara, topupAmount: 5000, reference: 'order_c' }), 75);
    assert.equal(await balance(cara), 135);
    assert.equal((await rows(cara, 'wallet_bonus')).length, 2);
});

await check('wallet bonus through the Shop top-up: a repeated verify pays top-up and bonus once', async () => {
    const dev = new mongoose.Types.ObjectId();
    const payload = { razorpayOrderId: 'order_dev_1', razorpayPaymentId: 'pay_dev_1', razorpaySignature: 'sig', amount: 1000 };
    await shopWallet.verifyWalletTopupPayment(dev, payload);
    await shopWallet.verifyWalletTopupPayment(dev, payload);
    assert.equal(await balance(dev), 1075);
    assert.equal((await rows(dev, 'wallet_topup')).length, 1);
    assert.equal((await rows(dev, 'wallet_bonus')).length, 1);
});

const dee = new mongoose.Types.ObjectId();

await check('loyalty: points per completed order, once, then converted into the wallet', async () => {
    await admin.writeLoyaltySettings(owner, { isEnabled: true, pointsPerHundred: 5, pointsPerRupee: 10, minConvertPoints: 10 });
    const order = await foodOrder(dee, 300);
    await foodCashback.awardOrderCashback(order);
    await foodCashback.awardOrderCashback(order);
    let summary = await loyalty.getLoyaltySummary(dee);
    assert.equal(summary.balance, 15);
    // Food's 10% offer also paid Rs 30 on this order.
    const before = await balance(dee);
    const out = await loyalty.convertPoints(dee, 15);
    assert.deepEqual([out.converted, out.amount, out.balance], [10, 1, 5]);
    assert.equal(await balance(dee), before + 1);
    await assert.rejects(loyalty.convertPoints(dee, 10), /Not enough points/);
    await assert.rejects(loyalty.convertPoints(dee, 5), /at least 10/);
    summary = await loyalty.getLoyaltySummary(dee);
    assert.equal(summary.converted, 10);
});

await check('loyalty: two conversions at once cannot spend the same points', async () => {
    const eve = new mongoose.Types.ObjectId();
    await LoyaltyAccount.create({ platformUserId: eve, balance: 20, earned: 20 });
    const r = await Promise.allSettled([loyalty.convertPoints(eve, 20), loyalty.convertPoints(eve, 20)]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(await balance(eve), 2);
});

await check('loyalty: a Shop return takes back the order\'s points by the same share', async () => {
    const fay = new mongoose.Types.ObjectId();
    const order = await shopOrder(fay, 400);
    await shopCashback.awardOrderCashback(order);
    assert.equal((await loyalty.getLoyaltySummary(fay)).balance, 20);
    await shopCashback.reverseOrderCashback(order, { refundedAmount: 100, orderTotal: 400, key: 'r1' });
    await shopCashback.reverseOrderCashback(order, { refundedAmount: 100, orderTotal: 400, key: 'r1' });
    assert.equal((await loyalty.getLoyaltySummary(fay)).balance, 15);
});

await check('the admin report lists every move with totals, and filters by type and date', async () => {
    const all = await admin.readLoyaltyReport(owner, {});
    assert.ok(all.items.length >= 5);
    assert.equal(all.totals.converted, 30);
    const converts = await admin.readLoyaltyReport(owner, { type: 'convert' });
    assert.ok(converts.items.every((r) => r.debit > 0 && r.credit === 0));
    const none = await admin.readLoyaltyReport(owner, { to: '2000-01-01' });
    assert.equal(none.items.length, 0);
    const ofDee = await admin.readLoyaltyReport(owner, { user: String(dee) });
    assert.equal(ofDee.items.length, 2);
});

await check('a partial refund on a Food order takes back its cashback pro rata, once per refund', async () => {
    const { reverseOrderCashbackShare } = await import('../src/core/promotions/orderRewards.js');
    const gus = new mongoose.Types.ObjectId();
    const order = await foodOrder(gus, 300); // Food 10%: Rs 30
    await foodCashback.awardOrderCashback(order);
    const args = { customerId: gus, orderId: order, refundedAmount: 100, orderTotal: 300, key: 'admin_refund:1' };
    assert.equal(await reverseOrderCashbackShare(args), 10);
    assert.equal(await reverseOrderCashbackShare(args), 0);
    assert.equal(await reverseOrderCashbackShare({ ...args, refundedAmount: 300, key: 'admin_refund:2' }), 20);
    assert.equal((await rows(gus, 'cashback_reversal')).length, 2);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
