/**
 * Shop customers merged into the shared `users` collection.
 *
 * Run: node tests/merge-ecom-users.smoke.mjs
 *
 * Seeds a pre-merge database (ecom_users rows: one linked by platformUserId,
 * one matched only by a differently written phone and switched off by the
 * Shop's admin, one with no platform account; their orders, cart, coins,
 * referral log, ticket, refresh token and wallet), then:
 *   - the dry run writes nothing;
 *   - before the script, an old Shop token still signs in (merged on the spot);
 *   - --apply merges the rest and rewrites every reference; re-running is a no-op;
 *   - after: Shop OTP sign-in (its own device counter, apart from Quick's),
 *     the session middleware, cart, order lists, wallet, referral, support,
 *     the Shop admin's customer list -- and --drop-old.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri('merge_ecom_users');
process.env.MONGODB_URI = uri;
process.env.MONGO_URI = uri;
await mongoose.connect(uri);
const db = mongoose.connection;

const { mergeEcomUsers } = await import('../scripts/migrations/mergeEcomUsers.mjs');
const { authMiddleware } = await import('../src/modules/ecommerce/core/auth/auth.middleware.js');
const { signAccessToken, signRefreshToken } = await import('../src/modules/ecommerce/core/auth/token.util.js');
const shopAuth = await import('../src/modules/ecommerce/core/auth/auth.service.js');
const shopOrders = await import('../src/modules/ecommerce/modules/commerce/orders/services/order.service.js');
const shopCart = await import('../src/modules/ecommerce/modules/commerce/user/services/userCart.service.js');
const shopWallet = await import('../src/modules/ecommerce/modules/commerce/user/services/userWallet.service.js');
const shopAdmin = await import('../src/modules/ecommerce/modules/commerce/admin/services/admin.service.js');
const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');
const { listCustomerTickets } = await import('../src/core/support/customerSupport.service.js');
const { resolveInviter } = await import('../src/core/referral/inviteCode.service.js');
const { clearShopCustomerCache } = await import('../src/core/identity/shopCustomer.js');
const { clearWalletOwnerCache } = await import('../src/core/wallet/linkedWallet.js');
const { setModuleEnabled } = await import('../src/core/modules/moduleState.service.js').catch(() => ({}));
if (setModuleEnabled) await setModuleEnabled('ecommerce', true).catch(() => {});

const oid = () => new mongoose.Types.ObjectId();
const asha = oid();
const ravi = oid();
const zed = oid();
const ashaS = oid();
const raviS = oid();
const lone = oid();
const seller = oid();
const t0 = new Date('2026-01-10T10:00:00Z');

await db.collection('users').insertMany([
    { _id: asha, phone: '9876543210', name: 'Asha P', role: 'USER', isActive: true, referralCount: 2, quickReferralCount: 1, tokenVersion: 7, fcmTokens: ['webTok'], addresses: [], createdAt: t0 },
    { _id: ravi, phone: '9123456789', role: 'USER', isActive: true, addresses: [], createdAt: t0 },
    { _id: zed, phone: '9555555555', name: 'Zed', role: 'USER', isActive: true, addresses: [], createdAt: t0 },
]);
const office = { _id: oid(), label: 'Office', street: '1 MG Road', city: 'Pune', state: 'MH', isDefault: true };
await db.collection('ecom_users').insertMany([
    { _id: ashaS, platformUserId: asha, phone: '9876543210', name: 'Asha S', email: 'asha@example.com', fcmTokens: ['shopTok'], addresses: [office], referralCount: 3, tokenVersion: 4, isActive: true, isVerified: true, role: 'USER', referralCode: String(ashaS), createdAt: t0 },
    { _id: raviS, phone: '+91 91234 56789', name: 'Ravi', referredBy: ashaS, isActive: false, role: 'USER', createdAt: t0 },
    { _id: lone, phone: '9000000000', name: 'Lone', addresses: [], isActive: true, role: 'USER', createdAt: t0 },
]);
const order = (userId, n) => ({
    _id: oid(), orderId: `EC${n}`, userId, sellerId: seller, orderStatus: 'delivered', fulfilmentMode: 'standard',
    pricing: { total: 100 + n }, statusHistory: [{ to: 'created', byRole: 'USER', byId: userId }], createdAt: new Date(t0.getTime() + n * 1000),
});
const [oAsha, oRavi, oLone] = [order(ashaS, 1), order(raviS, 2), order(lone, 3)];
await db.collection('ecom_orders').insertMany([oAsha, oRavi, oLone]);
await db.collection('ecom_user_carts').insertOne({ userId: ashaS, mode: 'shop', items: [{ name: 'Kurta' }] });
await db.collection('ecom_coin_lots').insertOne({ userId: ashaS, amount: 50, remaining: 50 });
await db.collection('ecom_referral_logs').insertOne({ referrerId: ashaS, refereeId: raviS, role: 'USER', status: 'credited', rewardAmount: 20 });
await db.collection('ecom_support_tickets').insertOne({ userId: raviS, type: 'order', orderId: oRavi._id, issueType: 'late', createdAt: t0, updatedAt: t0 });
await db.collection('food_user_wallets').insertOne({ userId: lone, balance: 50, transactions: [] });
const oldRefresh = signRefreshToken({ userId: String(ashaS), role: 'USER', tokenVersion: 4 });
await db.collection('ecom_refresh_tokens').insertOne({ userId: ashaS, token: oldRefresh, expiresAt: new Date(Date.now() + 86400000) });

const snapshot = async () => {
    const out = {};
    for (const { name } of await db.db.listCollections().toArray()) {
        out[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    }
    return out;
};
const session = (token) => new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); return this; },
        send(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    authMiddleware(req, res, () => resolve({ status: 200, user: req.user }));
});
const quiet = { log: () => {} };

console.log('\nDry run');
await check('the dry run writes nothing and reports what it would do', async () => {
    const before = await snapshot();
    const r = await mergeEcomUsers({ ...quiet });
    assert.equal(r.rows, 3);
    assert.equal(r.linked, 2);
    assert.equal(r.created, 1);
    assert.ok(r.refs['ecom_orders.userId'] >= 2);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nBefore the script runs');
await check('an old Shop token (ecom_users id) signs in as the platform account, merged on the spot', async () => {
    const out = await session(signAccessToken({ userId: String(ashaS), role: 'USER', tokenVersion: 4 }));
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.user.userId, String(asha));
    assert.equal(String((await db.collection('ecom_orders').findOne({ _id: oAsha._id })).userId), String(asha));
});
await check('a platform token of a customer the Shop switched off is refused', async () => {
    const out = await session(signAccessToken({ userId: String(ravi), role: 'USER' }));
    assert.equal(out.status, 401);
    assert.equal(String((await db.collection('ecom_orders').findOne({ _id: oRavi._id })).userId), String(ravi));
});

console.log('\nApply');
await check('--apply merges the rest and rewrites every reference', async () => {
    clearShopCustomerCache();
    const r = await mergeEcomUsers({ apply: true, ...quiet });
    assert.equal(r.already, 2);
    assert.equal(r.created, 1);
    assert.equal(r.leftUnmerged, 0);
    for (const o of await db.collection('ecom_orders').find({}).toArray()) {
        assert.ok([String(asha), String(ravi), String(lone)].includes(String(o.userId)));
    }
});
await check('Shop fields land under shop* names; Food\'s and Quick\'s are untouched', async () => {
    const a = await db.collection('users').findOne({ _id: asha });
    assert.equal(a.name, 'Asha P');
    assert.equal(a.email, 'asha@example.com');
    assert.equal(a.referralCount, 2);
    assert.equal(a.quickReferralCount, 1);
    assert.equal(a.shopReferralCount, 3);
    assert.equal(a.tokenVersion, 7, 'Quick\'s device counter untouched');
    assert.equal(a.shopTokenVersion, 4);
    assert.deepEqual([...a.fcmTokens].sort(), ['shopTok', 'webTok']);
    assert.ok(a.addresses.some((x) => String(x._id) === String(office._id)));
    const r = await db.collection('users').findOne({ _id: ravi });
    assert.equal(r.shopBlocked, true);
    assert.equal(r.isActive, true);
    assert.equal(String(r.shopReferredBy), String(asha));
    const l = await db.collection('users').findOne({ _id: lone });
    assert.ok(l?.shopJoinedAt);
    assert.equal(String((await db.collection('ecom_coin_lots').findOne({})).userId), String(asha));
    assert.equal(String((await db.collection('ecom_referral_logs').findOne({})).refereeId), String(ravi));
});
await check('running --apply again changes nothing', async () => {
    const before = await snapshot();
    const r = await mergeEcomUsers({ apply: true, ...quiet });
    assert.equal(r.already, 3);
    const after = await snapshot();
    delete before.ecom_user_id_map; delete after.ecom_user_id_map;
    assert.deepEqual(after, before);
});

console.log('\nAfter the switch');
await check('Shop OTP sign-in finds the merged account; its device counter is the Shop\'s', async () => {
    const { otp } = await shopAuth.requestUserOtp('9876543210');
    const out = await shopAuth.verifyUserOtpAndLogin('9876543210', otp);
    assert.equal(String(out.user._id), String(asha));
    const a = await db.collection('users').findOne({ _id: asha });
    assert.equal(a.shopTokenVersion, 5);
    assert.equal(a.tokenVersion, 7, 'signing in to the Shop does not sign Quick out');
    const s = await session(out.accessToken);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.user.userId, String(asha));
});
await check('cart, orders, wallet and support read the merged rows', async () => {
    const cart = await shopCart.getUserCart(String(asha), 'shop');
    assert.ok(cart, 'cart');
    const mine = await shopOrders.listOrdersUser(String(lone), {});
    assert.equal((mine.docs || mine.items || mine.data || []).length, 1);
    const all = await listMyOrders(String(ravi), {});
    assert.ok(all.items.some((i) => i.service === 'shop'), JSON.stringify(all.items));
    clearWalletOwnerCache();
    assert.equal((await shopWallet.getUserWallet(String(lone))).balance, 50);
    const tickets = await listCustomerTickets(String(ravi));
    assert.ok((tickets.items || tickets).some?.((t) => String(t.service || '').includes('shop')), JSON.stringify(tickets));
});
await check('the Shop admin lists Shop customers only, and its switch is the Shop\'s', async () => {
    const { customers } = await shopAdmin.getCustomers({});
    const ids = customers.map((c) => String(c._id));
    assert.ok(ids.includes(String(asha)) && ids.includes(String(ravi)) && ids.includes(String(lone)));
    assert.ok(!ids.includes(String(zed)));
    const on = await shopAdmin.updateCustomerStatus(String(ravi), true);
    assert.equal(on.isActive, true);
    clearShopCustomerCache();
    assert.equal((await session(signAccessToken({ userId: String(ravi), role: 'USER' }))).status, 200);
});
await check('an old refresh token and an old invite code name the platform account', async () => {
    const out = await shopAuth.refreshAccessToken(oldRefresh).catch((e) => ({ err: e }));
    // The Shop sign-in above moved the device counter on: the old device is out.
    assert.ok(out.err, 'an evicted device cannot refresh');
    assert.equal(String(await resolveInviter(String(ashaS))), String(asha));
});

console.log('\nRetiring ecom_users');
await check('--drop-old retires ecom_users and old ids still resolve', async () => {
    const r = await mergeEcomUsers({ dropOld: true, ...quiet });
    assert.ok(r.renamed, JSON.stringify(r));
    clearShopCustomerCache();
    const s = await session(signAccessToken({ userId: String(lone), role: 'USER' }));
    assert.equal(s.status, 200);
    assert.equal(String(await resolveInviter(String(ashaS))), String(asha));
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
