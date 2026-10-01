/**
 * Services customers merged into the shared `users` collection, with a
 * Services profile (sp_profiles) under the same _id.
 *
 * Run: node tests/merge-sp-users.smoke.mjs
 *
 * Seeds a pre-merge database (sp_users rows: one linked by platformUserId, one
 * matched only by a differently written phone and blocked by the Services
 * admin, one with no platform account and its own Services balance; their
 * bookings, cart, referral log, transactions; a penalty owed), then:
 *   - the dry run writes nothing;
 *   - before the script, an old Services token and a platform token both work,
 *     merging on the spot;
 *   - --apply merges the rest; re-running is a no-op;
 *   - after: Services-native sign-in (phone + OTP) and platform sign-in, booking
 *     reads, the shared wallet with the penalty kept on the Services side,
 *     referral, support, the Services admin's customer screens -- and --drop-old.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
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

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = replSet.getUri();
process.env.MONGO_URI = uri;
process.env.MONGODB_URI = uri;
await mongoose.connect(uri, { dbName: 'merge_sp_users' });
const db = mongoose.connection;

const { mergeSpUsers } = await import('../scripts/migrations/mergeSpUsers.mjs');
const User = require('../src/modules/serviceProvider/models/User.js');
const Booking = require('../src/modules/serviceProvider/models/Booking.js');
const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
const { authenticate } = require('../src/modules/serviceProvider/middleware/authMiddleware.js');
const { generateTokenPair } = require('../src/modules/serviceProvider/utils/tokenService.js');
const auth = require('../src/modules/serviceProvider/controllers/userControllers/userAuthController.js');
const { getWalletBalance } = require('../src/modules/serviceProvider/controllers/userControllers/userWalletController.js');
const bookings = require('../src/modules/serviceProvider/controllers/bookingControllers/userBookingController.js');
const adminUsers = require('../src/modules/serviceProvider/controllers/adminControllers/adminUserController.js');
const referral = require('../src/modules/serviceProvider/services/referralService.js');
const { hashOTP, storeOTP } = require('../src/modules/serviceProvider/utils/redisOtp.util.js');
const { __testables } = require('../src/modules/serviceProvider/utils/sharedWalletBridge.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { resolveInviter } = await import('../src/core/referral/inviteCode.service.js');
const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');
const { clearSpCustomerCache } = await import('../src/core/identity/spCustomer.js');
for (const c of ['users', 'sp_profiles', 'sp_users', 'sp_bookings', 'sp_transactions', 'food_user_wallets', 'sp_user_id_map']) {
    await db.createCollection(c).catch(() => {});
}
await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

const oid = () => new mongoose.Types.ObjectId();
const asha = oid();
const ravi = oid();
const ashaSp = oid();
const raviSp = oid();
const lone = oid();
const t0 = new Date('2026-01-10T10:00:00Z');

await db.collection('users').insertMany([
    { _id: asha, phone: '9876543210', name: 'Asha P', role: 'USER', isActive: true, referralCount: 2, addresses: [], createdAt: t0 },
    { _id: ravi, phone: '9123456789', role: 'USER', isActive: true, addresses: [], createdAt: t0 },
]);
await CustomerWallet.create({ userId: asha, balance: 300 });
await db.collection('sp_users').insertMany([
    {
        _id: ashaSp, platformUserId: asha, name: 'Asha S', phone: '9876543210', email: 'asha@example.com', role: 'user',
        addresses: [{ type: 'home', addressLine1: '1 MG Road', city: 'Pune' }], wallet: { balance: 0, penalty: 49 },
        plans: { isActive: true, name: 'Gold', price: 199 }, totalBookings: 3, favouriteServices: [], referralCode: 'SPASHA1', referralCount: 1,
        loginSessionId: 'sess-asha', isActive: true, createdAt: t0,
    },
    { _id: raviSp, name: 'Ravi', phone: '+91 91234 56789', referredBy: ashaSp, wallet: { balance: 0, penalty: 0 }, isActive: false, createdAt: t0 },
    { _id: lone, name: 'Lone', phone: '9000000000', wallet: { balance: 80, penalty: 0 }, isActive: true, createdAt: t0 },
]);
const booking = (userId, n) => ({ _id: oid(), bookingNumber: `SPB${n}`, userId, status: 'completed', finalAmount: 100 + n, createdAt: new Date(t0.getTime() + n * 1000), updatedAt: t0 });
const [bAsha, bRavi, bLone] = [booking(ashaSp, 1), booking(raviSp, 2), booking(lone, 3)];
await db.collection('sp_bookings').insertMany([bAsha, bRavi, bLone]);
await db.collection('sp_carts').insertOne({ userId: ashaSp, items: [] });
await db.collection('sp_referral_logs').insertOne({ referrerId: ashaSp, refereeId: raviSp, refereePhone: '9123456789', status: 'credited', reward: 20 });
await db.collection('sp_transactions').insertOne({ userId: lone, type: 'credit', amount: 80, status: 'completed' });

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
    };
    authenticate(req, res, () => resolve({ status: 200, user: req.user, userId: req.userId }));
});
const call = (fn, req) => new Promise((resolve) => {
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); return this; },
        cookie() { return this; },
    };
    Promise.resolve(fn(req, res)).catch((err) => resolve({ status: 500, body: { message: err.message } }));
});
const spToken = (userId, extra = {}) => generateTokenPair({ userId, role: 'USER', ...extra }).accessToken;
const quiet = { log: () => {} };

console.log('\nDry run');
await check('the dry run writes nothing and reports what it would do', async () => {
    const before = await snapshot();
    const r = await mergeSpUsers({ ...quiet });
    assert.equal(r.rows, 3);
    assert.equal(r.linked, 2);
    assert.equal(r.created, 1);
    assert.ok(r.refs['sp_bookings.userId'] >= 2);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nBefore the script runs');
await check('an old Services token (sp_users id) signs in as the platform account, merged on the spot', async () => {
    const s = await session(spToken(ashaSp, { loginSessionId: 'sess-asha' }));
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.userId, String(asha));
    const profile = await db.collection('sp_profiles').findOne({ _id: asha });
    assert.equal(profile.wallet.penalty, 49, 'the penalty stays on the Services side');
    assert.equal(profile.plans.name, 'Gold');
    assert.equal(profile.addresses[0].addressLine1, '1 MG Road');
    assert.equal(String((await db.collection('sp_bookings').findOne({ _id: bAsha._id })).userId), String(asha));
});
await check('a platform token of a customer the Services admin blocked is refused', async () => {
    const s = await session(spToken(ravi));
    assert.equal(s.status, 403, JSON.stringify(s.body));
    assert.equal(String((await db.collection('sp_bookings').findOne({ _id: bRavi._id })).userId), String(ravi));
    const r = await db.collection('users').findOne({ _id: ravi });
    assert.equal(r.spBlocked, true);
    assert.equal(r.isActive, true, 'not blocked everywhere');
});

console.log('\nApply');
await check('--apply merges the rest and rewrites every reference', async () => {
    clearSpCustomerCache();
    const r = await mergeSpUsers({ apply: true, ...quiet });
    assert.equal(r.already, 2);
    assert.equal(r.created, 1);
    assert.equal(r.leftUnmerged, 0);
    for (const b of await db.collection('sp_bookings').find({}).toArray()) {
        assert.ok([String(asha), String(ravi), String(lone)].includes(String(b.userId)));
    }
    assert.equal(String((await db.collection('sp_referral_logs').findOne({})).refereeId), String(ravi));
});
await check('Services fields land under sp* names; the platform\'s are untouched', async () => {
    const a = await db.collection('users').findOne({ _id: asha });
    assert.equal(a.name, 'Asha P');
    assert.equal(a.email, 'asha@example.com');
    assert.equal(a.referralCount, 2);
    assert.equal(a.spReferralCount, 1);
    assert.equal(a.spReferralCode, 'SPASHA1');
    assert.deepEqual(a.addresses, [], 'Services addresses are another shape: kept on its profile');
    const r = await db.collection('users').findOne({ _id: ravi });
    assert.equal(String(r.spReferredBy), String(asha));
    const l = await db.collection('users').findOne({ _id: lone });
    assert.ok(l?.spJoinedAt);
});
await check('a Services-only balance moved into the shared wallet once', async () => {
    assert.equal((await CustomerWallet.findOne({ userId: lone }).lean()).balance, 80);
    assert.equal((await db.collection('sp_profiles').findOne({ _id: lone })).wallet.balance, 0);
});
await check('running --apply again changes nothing', async () => {
    const before = await snapshot();
    const r = await mergeSpUsers({ apply: true, ...quiet });
    assert.equal(r.already, 3);
    const after = await snapshot();
    delete before.sp_user_id_map; delete after.sp_user_id_map;
    assert.deepEqual(after, before);
});

console.log('\nAfter the switch');
await check('Services-native sign-in (phone + OTP) finds the merged customer', async () => {
    await storeOTP('9000000000', hashOTP('482913'));
    const out = await call(auth.login, { body: { phone: '9000000000', otp: '482913' }, headers: {} });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(String(out.body.user.id), String(lone));
    const s = await session(out.body.accessToken || out.body.tokens?.accessToken || out.body.data?.accessToken);
    assert.equal(s.userId, String(lone));
});
await check('a Services-native sign-up makes the profile under a platform account', async () => {
    await storeOTP('9444444444', hashOTP('111222'));
    const out = await call(auth.register, { body: { name: 'Neha', phone: '9444444444', otp: '111222' }, headers: {} });
    assert.ok(out.status < 300, JSON.stringify(out.body));
    const account = await db.collection('users').findOne({ phone: '9444444444' });
    assert.ok(account?.spJoinedAt);
    assert.ok(await db.collection('sp_profiles').findOne({ _id: account._id }));
});
await check('a platform customer new to Services gets a profile under their own id', async () => {
    const meera = oid();
    await db.collection('users').insertOne({ _id: meera, phone: '9333333333', name: 'Meera', role: 'USER', isActive: true });
    const s = await session(spToken(meera));
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.userId, String(meera));
});
await check('bookings and My Orders read the merged rows', async () => {
    const out = await call(bookings.getUserBookings, { user: { id: String(lone), _id: lone }, userId: String(lone), query: {} });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const list = out.body.data?.bookings || out.body.data || out.body.bookings || [];
    assert.equal(list.length, 1);
    const mine = await listMyOrders(String(asha), {});
    assert.ok(mine.items.some((i) => i.service === 'services'), JSON.stringify(mine.items));
});
await check('wallet: the shared balance shows in Services; the penalty stays Services-side', async () => {
    __testables.clearCache();
    const out = await call(getWalletBalance, { user: { id: String(asha) } });
    assert.equal(out.body.data.balance, 300);
    assert.equal((await db.collection('sp_profiles').findOne({ _id: asha })).wallet.penalty, 49);
    const debit = await User.findOneAndUpdate({ _id: asha, 'wallet.balance': { $gte: 100 } }, { $inc: { 'wallet.balance': -100 } }, { new: true });
    assert.equal(debit.wallet.balance, 200);
    assert.equal((await CustomerWallet.findOne({ userId: asha }).lean()).balance, 200);
});
await check('referral: the old SP code and the share screen name the platform account', async () => {
    assert.equal(String(await resolveInviter('SPASHA1')), String(asha));
    const summary = await referral.referralSummary(String(asha));
    assert.equal(summary.rewarded, 1);
});
await check('support: a ticket on a merged booking is the customer\'s own', async () => {
    const { createCustomerTicket } = await import('../src/core/support/customerSupport.service.js');
    const ticket = await createCustomerTicket(String(asha), { service: 'services', orderId: String(bAsha._id), issueType: 'Late' });
    assert.ok(ticket?.key || ticket?.id || ticket?._id, JSON.stringify(ticket));
});
await check('the Services admin lists customers and its block is Services-only', async () => {
    const list = await call(adminUsers.getAllUsers, { query: {} });
    const ids = (list.body.data?.users || list.body.data || []).map((u) => String(u._id));
    assert.ok(ids.includes(String(asha)) && ids.includes(String(lone)), JSON.stringify(list.body).slice(0, 300));
    await call(adminUsers.toggleUserStatus, { params: { id: String(ravi) }, body: { isActive: true } });
    assert.equal((await db.collection('users').findOne({ _id: ravi })).spBlocked, false);
    clearSpCustomerCache();
    assert.equal((await session(spToken(ravi))).status, 200);
    await call(adminUsers.toggleUserStatus, { params: { id: String(ravi) }, body: { isActive: false } });
    const r = await db.collection('users').findOne({ _id: ravi });
    assert.equal(r.spBlocked, true);
    assert.equal(r.isActive, true);
});

console.log('\nRetiring sp_users');
await check('--drop-old retires sp_users; old ids still resolve', async () => {
    const r = await mergeSpUsers({ dropOld: true, ...quiet });
    assert.ok(r.renamed, JSON.stringify(r));
    clearSpCustomerCache();
    const s = await session(spToken(lone));
    assert.equal(s.userId, String(lone));
    assert.equal(String(await resolveInviter(String(ashaSp))), String(asha));
});

await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
