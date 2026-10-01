/**
 * Quick customers merged into the shared `users` collection.
 *
 * Run: node tests/merge-qc-users.smoke.mjs
 *
 * Seeds a pre-merge database (qc_users rows: one linked by platformUserId, one
 * matched only by a differently written phone and switched off by Quick's
 * admin, one with no platform account at all; their orders, cart, referral
 * log, payment, ticket, refresh token and wallet), then:
 *   - the dry run writes nothing;
 *   - before the script runs, an old Quick token still signs in -- the
 *     customer is merged on that request;
 *   - --apply merges the rest and rewrites every reference;
 *   - running it again changes nothing;
 *   - after: Quick OTP sign-in, the session middleware, order lists, the
 *     admin's customer list and switch, an old refresh token, an old invite
 *     code -- and --drop-old refuses while a clash is left, then retires the
 *     collection while old ids keep resolving through the map.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
// Sign-in codes come back in the response only with the development opt-in.
process.env.USE_DEFAULT_OTP = 'true';
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
const uri = mongo.getUri('merge_qc_users');
process.env.MONGODB_URI = uri;
process.env.MONGO_URI = uri;
await mongoose.connect(uri);
const db = mongoose.connection;

const { mergeQcUsers } = await import('../scripts/migrations/mergeQcUsers.mjs');
const { authMiddleware } = await import('../src/modules/quickCommerce/core/auth/auth.middleware.js');
const { signAccessToken, signRefreshToken } = await import('../src/modules/quickCommerce/core/auth/token.util.js');
const quickAuth = await import('../src/modules/quickCommerce/core/auth/auth.service.js');
const quickOrders = await import('../src/modules/quickCommerce/modules/food/orders/services/order.service.js');
const quickAdmin = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');
const { resolveInviter } = await import('../src/core/referral/inviteCode.service.js');
const { clearQuickCustomerCache } = await import('../src/core/identity/quickCustomer.js');
const { clearWalletOwnerCache } = await import('../src/core/wallet/linkedWallet.js');

const oid = () => new mongoose.Types.ObjectId();
const asha = oid();
const ravi = oid();
const zed = oid(); // Food only, never used Quick
const ashaQ = oid();
const raviQ = oid();
const lone = oid(); // Quick only, no platform account
const store = oid();
const t0 = new Date('2026-01-10T10:00:00Z');

await db.collection('users').insertMany([
    { _id: asha, phone: '9876543210', name: 'Asha P', role: 'USER', isActive: true, referralCount: 2, fcmTokens: ['webTok'], addresses: [], createdAt: t0 },
    { _id: ravi, phone: '9123456789', role: 'USER', isActive: true, addresses: [], createdAt: t0 },
    { _id: zed, phone: '9555555555', name: 'Zed', role: 'USER', isActive: true, addresses: [], createdAt: t0 },
]);
const office = { _id: oid(), label: 'Office', street: '1 MG Road', city: 'Pune', state: 'MH', isDefault: true };
await db.collection('qc_users').insertMany([
    { _id: ashaQ, platformUserId: asha, phone: '9876543210', name: 'Asha Q', email: 'asha@example.com', fcmTokens: ['qcTok'], addresses: [office], referralCount: 3, tokenVersion: 4, isActive: true, isVerified: true, role: 'USER', referralCode: String(ashaQ), createdAt: t0 },
    { _id: raviQ, phone: '+91 91234 56789', name: 'Ravi', referredBy: ashaQ, isActive: false, role: 'USER', createdAt: t0 },
    { _id: lone, phone: '9000000000', name: 'Lone', addresses: [{ _id: oid(), label: 'Home', street: '2 Lane', city: 'Pune', state: 'MH', isDefault: true }], tokenVersion: 1, isActive: true, role: 'USER', createdAt: t0 },
]);
const order = (userId, n) => ({
    _id: oid(), orderId: `QC${n}`, userId, restaurantId: store, orderStatus: 'delivered',
    pricing: { total: 100 + n }, statusHistory: [{ to: 'created', byRole: 'USER', byId: userId }], createdAt: new Date(t0.getTime() + n * 1000),
});
const [oAsha, oRavi, oLone] = [order(ashaQ, 1), order(raviQ, 2), order(lone, 3)];
await db.collection('qc_orders').insertMany([oAsha, oRavi, oLone]);
await db.collection('qc_user_carts').createIndex({ userId: 1 }, { unique: true });
await db.collection('qc_user_carts').insertMany([
    { userId: ashaQ, items: [{ name: 'Milk' }] },
    { userId: asha, items: [{ name: 'Bread' }] }, // a cart already on the platform id: a clash
    { userId: raviQ, items: [] },
]);
await db.collection('qc_referral_logs').insertOne({ referrerId: ashaQ, refereeId: raviQ, role: 'USER', status: 'credited', rewardAmount: 20 });
await db.collection('payments').insertOne({ payerId: raviQ, payerModel: 'QCUser', amount: 102 });
await db.collection('qc_support_tickets').insertOne({ userId: raviQ, type: 'order', orderId: oRavi._id, issueType: 'late' });
await db.collection('food_user_wallets').insertOne({ userId: lone, balance: 50, transactions: [] });
const oldRefresh = signRefreshToken({ userId: String(ashaQ), role: 'USER', tokenVersion: 4 });
await db.collection('qc_refresh_tokens').insertOne({ userId: ashaQ, token: oldRefresh, expiresAt: new Date(Date.now() + 86400000) });

/** Every document of every collection, for "nothing changed". */
const snapshot = async () => {
    const out = {};
    for (const { name } of await db.db.listCollections().toArray()) {
        out[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    }
    return out;
};

/** Runs Quick's session middleware with a token; resolves to { status, user }. */
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
    const r = await mergeQcUsers({ apply: false, ...quiet });
    assert.equal(r.rows, 3);
    assert.equal(r.linked, 2);
    assert.equal(r.created, 1);
    assert.ok(r.refs['qc_orders.userId'] >= 2);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nBefore the script runs');
await check('an old Quick token (qc_users id) signs in as the platform account, merged on the spot', async () => {
    const out = await session(signAccessToken({ userId: String(ashaQ), role: 'USER', tokenVersion: 4 }));
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.user.userId, String(asha));
    const o = await db.collection('qc_orders').findOne({ _id: oAsha._id });
    assert.equal(String(o.userId), String(asha));
    assert.equal(String(o.statusHistory[0].byId), String(asha));
    const map = await db.collection('qc_user_id_map').findOne({ _id: ashaQ });
    assert.ok(map?.doneAt);
});
await check('a platform token reaches orders of a row not merged yet', async () => {
    // Ravi's Quick row is off in Quick: the session says so rather than serving.
    const out = await session(signAccessToken({ userId: String(ravi), role: 'USER' }));
    assert.equal(out.status, 401);
    assert.match(String(out.body?.message || JSON.stringify(out.body)), /deactivated/i);
    assert.equal(String((await db.collection('qc_orders').findOne({ _id: oRavi._id })).userId), String(ravi));
});

console.log('\nApply');
let applied;
await check('--apply merges the rest and rewrites every reference', async () => {
    clearQuickCustomerCache();
    applied = await mergeQcUsers({ apply: true, ...quiet });
    assert.equal(applied.rows, 3);
    assert.equal(applied.already, 2);
    assert.equal(applied.created, 1);
    assert.equal(applied.leftUnmerged, 0);
    assert.ok(await db.collection('qc_user_id_map').findOne({ _id: '__all_merged__' }));
    for (const o of await db.collection('qc_orders').find({}).toArray()) {
        assert.ok([String(asha), String(ravi), String(lone)].includes(String(o.userId)), String(o.userId));
    }
});
await check('the person who existed only in Quick is a platform account under the same id', async () => {
    const u = await db.collection('users').findOne({ _id: lone });
    assert.equal(u.phone, '9000000000');
    assert.equal(u.name, 'Lone');
    assert.equal(u.addresses.length, 1);
    assert.ok(u.quickJoinedAt);
    assert.equal((await db.collection('food_user_wallets').findOne({ userId: lone })).balance, 50);
});
await check('Quick fields land under their own names; Food\'s are untouched', async () => {
    const a = await db.collection('users').findOne({ _id: asha });
    assert.equal(a.name, 'Asha P', 'the account\'s own name wins');
    assert.equal(a.email, 'asha@example.com', 'a blank is filled');
    assert.equal(a.referralCount, 2);
    assert.equal(a.quickReferralCount, 3);
    assert.equal(a.tokenVersion, 4);
    assert.deepEqual([...a.fcmTokens].sort(), ['qcTok', 'webTok']);
    assert.ok(a.addresses.some((x) => String(x._id) === String(office._id)), 'the Quick address keeps its id');
    const r = await db.collection('users').findOne({ _id: ravi });
    assert.equal(r.quickBlocked, true);
    assert.equal(r.isActive, true, 'Quick\'s switch does not close the account everywhere');
    assert.equal(String(r.quickReferredBy), String(asha));
    assert.equal(r.referredBy ?? null, null);
});
await check('shared rows follow: referral log, payment, ticket, refresh token', async () => {
    const log = await db.collection('qc_referral_logs').findOne({});
    assert.equal(String(log.referrerId), String(asha));
    assert.equal(String(log.refereeId), String(ravi));
    const p = await db.collection('payments').findOne({});
    assert.equal(String(p.payerId), String(ravi));
    assert.equal(p.payerModel, 'FoodUser');
    assert.equal(String((await db.collection('qc_support_tickets').findOne({})).userId), String(ravi));
    assert.equal(String((await db.collection('qc_refresh_tokens').findOne({})).userId), String(asha));
});
await check('a cart clash is left on the old id and reported', async () => {
    assert.equal(await db.collection('qc_user_carts').countDocuments({ userId: ashaQ }), 1);
    assert.equal(await db.collection('qc_user_carts').countDocuments({ userId: asha }), 1);
    assert.equal(await db.collection('qc_user_carts').countDocuments({ userId: ravi }), 1);
});
await check('running --apply again changes nothing', async () => {
    const before = await snapshot();
    const again = await mergeQcUsers({ apply: true, ...quiet });
    assert.equal(again.already, 3);
    const after = await snapshot();
    delete before.qc_user_id_map; delete after.qc_user_id_map; // the done marker's timestamp
    assert.deepEqual(after, before);
});

console.log('\nAfter the switch');
await check('Quick OTP sign-in finds the merged account and its session resolves', async () => {
    const { otp } = await quickAuth.requestUserOtp('9000000000');
    const out = await quickAuth.verifyUserOtpAndLogin('9000000000', otp);
    assert.equal(String(out.user._id), String(lone));
    const s = await session(out.accessToken);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.user.userId, String(lone));
    assert.equal(await db.collection('users').countDocuments({ phone: /9000000000$/ }), 1);
});
await check('a brand-new Quick customer is made in users, not qc_users', async () => {
    const { otp } = await quickAuth.requestUserOtp('9444444444');
    const out = await quickAuth.verifyUserOtpAndLogin('9444444444', otp, undefined, undefined, undefined, 'Neha');
    assert.equal(out.isNewUser, true);
    assert.ok(await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(String(out.user._id)), quickJoinedAt: { $ne: null } }));
    assert.equal(await db.collection('qc_users').countDocuments({ phone: /9444444444$/ }), 0);
});
await check('order reads: Quick\'s own list and My Orders', async () => {
    const mine = await quickOrders.listOrdersUser(String(asha), {});
    const list = mine.docs || mine.items || mine.data || [];
    assert.equal(list.length, 1);
    const all = await listMyOrders(String(ravi), {});
    assert.ok(all.items.some((i) => i.service === 'quick'), JSON.stringify(all.items));
});
await check('Quick\'s admin lists Quick customers only, and its switch is Quick\'s', async () => {
    const { customers, total } = await quickAdmin.getCustomers({});
    const ids = customers.map((c) => String(c._id));
    assert.ok(ids.includes(String(asha)) && ids.includes(String(ravi)) && ids.includes(String(lone)));
    assert.ok(!ids.includes(String(zed)), 'a Food-only customer is not Quick\'s');
    assert.equal(total, ids.length);
    assert.equal(customers.find((c) => String(c._id) === String(ravi)).isActive, false);
    const on = await quickAdmin.updateCustomerStatus(String(ravi), true);
    assert.equal(on.isActive, true);
    clearQuickCustomerCache();
    const s = await session(signAccessToken({ userId: String(ravi), role: 'USER' }));
    assert.equal(s.status, 200);
});
await check('an old refresh token mints an access token for the platform account', async () => {
    const out = await quickAuth.refreshAccessToken(oldRefresh);
    const s = await session(out.accessToken);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.user.userId, String(asha));
});
await check('an old Quick invite code (its qc id) names the platform account', async () => {
    assert.equal(String(await resolveInviter(String(ashaQ))), String(asha));
});

console.log('\nRetiring qc_users');
await check('--drop-old refuses while a clash still names an old id', async () => {
    const r = await mergeQcUsers({ dropOld: true, ...quiet });
    assert.equal(r.refused, true);
    assert.ok(await db.collection('qc_users').countDocuments() > 0);
});
await check('once settled, --drop-old retires qc_users and old ids still resolve', async () => {
    await db.collection('qc_user_carts').deleteOne({ userId: ashaQ });
    const r = await mergeQcUsers({ dropOld: true, ...quiet });
    assert.ok(r.renamed, JSON.stringify(r));
    assert.equal((await db.db.listCollections({ name: 'qc_users' }).toArray()).length, 0);
    clearQuickCustomerCache();
    clearWalletOwnerCache();
    const s = await session(signAccessToken({ userId: String(ashaQ), role: 'USER', tokenVersion: 4 }));
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.user.userId, String(asha));
    assert.equal(String(await resolveInviter(String(ashaQ))), String(asha));
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
