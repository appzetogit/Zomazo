/**
 * Every service's invite link is redeemed at the one platform sign-in.
 *
 * Run: node tests/invite-links.smoke.mjs
 *
 * All customer apps sign in on /login now, so Food's, Taxi's and the Shop's
 * invite links all land there with ?ref=<code>&via=<service>, and the sign-in
 * passes both on (ref, refService). What this guards:
 *   - Food (the default): a new account with a friend's account id pays Food's
 *     reward, once; the referral code on the account works too;
 *   - Taxi: the friend's Taxi code sets referredBy on the new account, counts
 *     for the friend and pays Taxi's sign-up reward into the shared wallet;
 *   - Shop: a Shop row is made for the new customer and the friend's Shop row
 *     is paid the Shop's reward, within its limit; nothing while the Shop's
 *     module is switched off;
 *   - an existing customer signing in again redeems nothing; one's own code
 *     never pays; an unknown `refService` falls back to Food, and a bad code
 *     never fails the sign-in;
 *   - one code per person: the friend's platform code pays Quick's and
 *     Services' programmes too (via=quick, via=services), an old service code
 *     still names its person anywhere, and every share screen shows one code;
 *   - Master > Referral lists the Shop only while its module is on.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
// Sign-in codes come back in the response only with the development opt-in.
process.env.USE_DEFAULT_OTP = 'true';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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
await mongoose.connect(replSet.getUri(), { dbName: 'invite_links' });
const db = mongoose.connection;

const { requestUserOtp, verifyUserOtpAndLogin } = await import('../src/core/auth/auth.service.js');
const { validateUserOtpVerifyDto } = await import('../src/dtos/auth/userOtpVerify.dto.js');
const { FoodReferralSettings } = await import('../src/modules/food/admin/models/referralSettings.model.js');
const { FoodReferralLog } = await import('../src/modules/food/admin/models/referralLog.model.js');
const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { ReferralSettings: ShopReferralSettings } = await import('../src/modules/ecommerce/modules/commerce/admin/models/referralSettings.model.js');
const { ReferralLog: ShopReferralLog } = await import('../src/modules/ecommerce/modules/commerce/admin/models/referralLog.model.js');
const { User: ShopUser } = await import('../src/modules/ecommerce/core/users/user.model.js');
const { setModuleEnabled } = await import('../src/core/modules/moduleState.service.js');
const { referralOverview } = await import('../src/core/referral/referralSettings.service.js');
for (const M of [FoodReferralLog, ShopReferralLog, ShopUser, CustomerWallet]) {
  await M.createCollection().catch(() => {});
  await M.init().catch(() => {});
}

await FoodReferralSettings.create({ referralRewardUser: 25, referralLimitUser: 5, isActive: true });
await AdminBusinessSetting.create({
  scope: 'default',
  referral: { user: { enabled: true, type: 'instant_referrer', amount: 40, ride_count: 0 } },
});
await ShopReferralSettings.create({ referralRewardUser: 30, referralLimitUser: 1, isActive: true });

// Ravi invites: one platform account, and his own Shop row.
const ravi = new mongoose.Types.ObjectId();
await db.collection('users').insertOne({ _id: ravi, phone: '9000000001', name: 'Ravi', isActive: true, referralCode: 'USR0001ABCDEF' });
const raviShop = new mongoose.Types.ObjectId();
await db.collection('ecom_users').insertOne({ _id: raviShop, phone: '9000000001', platformUserId: ravi, referralCode: String(raviShop), referralCount: 0, isActive: true });

let nextPhone = 9100000000;
/** A brand-new customer signing in on /login through an invite. */
const signUp = async (body = {}) => {
  const phone = String(nextPhone++);
  const { otp } = await requestUserOtp(phone);
  const dto = validateUserOtpVerifyDto({ phone, otp, ...body });
  const out = await verifyUserOtpAndLogin(dto.phone, dto.otp, dto.ref, dto.fcmToken, dto.platform, dto.name, dto.refService);
  return { phone, id: out.user._id, isNewUser: out.isNewUser };
};
const walletRows = async (userId) => (await CustomerWallet.findOne({ userId }).lean())?.transactions || [];

console.log('\nFood (the default)');
await check('a friend\'s account id pays Food\'s reward and records who invited', async () => {
  const me = await signUp({ ref: String(ravi) });
  assert.equal(me.isNewUser, true);
  const log = await FoodReferralLog.findOne({ refereeId: me.id }).lean();
  assert.equal(log?.status, 'credited');
  assert.equal(log.rewardAmount, 25);
  const doc = await db.collection('users').findOne({ _id: me.id });
  assert.equal(String(doc.referredBy), String(ravi));
});
await check('the referral code on the account works as a Food invite too', async () => {
  const me = await signUp({ ref: 'usr0001abcdef' });
  assert.equal((await FoodReferralLog.findOne({ refereeId: me.id }).lean())?.status, 'credited');
});
await check('an unknown refService is Food, never a failed sign-in', async () => {
  const me = await signUp({ ref: String(ravi), refService: 'spaceships' });
  assert.equal((await FoodReferralLog.findOne({ refereeId: me.id }).lean())?.status, 'credited');
});
await check('a code nobody has is ignored and the sign-in still works', async () => {
  const me = await signUp({ ref: 'NOPE123', refService: 'taxi' });
  assert.ok(me.id);
  const doc = await db.collection('users').findOne({ _id: me.id });
  assert.ok(!doc.referredBy);
});

console.log('\nTaxi');
await check('Taxi\'s code sets referredBy, counts for Ravi and pays Taxi\'s reward', async () => {
  const before = (await db.collection('users').findOne({ _id: ravi })).referralCount || 0;
  const me = await signUp({ ref: 'USR0001ABCDEF', refService: 'taxi' });
  const log = await db.collection('taxi_referral_logs').findOne({ refereeId: me.id });
  assert.equal(log?.status, 'credited');
  assert.equal(log.kind, 'signup');
  assert.equal(String(log.referrerId), String(ravi));
  assert.equal(log.rewardAmount, 40);
  const doc = await db.collection('users').findOne({ _id: me.id });
  assert.equal(String(doc.referredBy), String(ravi));
  assert.equal((await db.collection('users').findOne({ _id: ravi })).referralCount, before + 1);
  const paid = (await walletRows(ravi)).find((t) => t.referenceKey === `user-referral:signup:${me.id}:referrer`);
  assert.ok(paid, 'no taxi reward in the wallet');
  assert.equal(paid.amount, 40);
  // Taxi's invite is not also paid as a Food one.
  assert.equal(await FoodReferralLog.countDocuments({ refereeId: me.id }), 0);
});

console.log('\nShop');
// Shop customers are platform accounts since the ecom_users merge: Ravi's old
// Shop code (his ecom_users id) names his platform account, which keeps the
// Shop's count as shopReferralCount.
await check('a Shop invite makes the new customer a Shop customer and pays Ravi', async () => {
  const me = await signUp({ ref: String(raviShop), refService: 'shop' });
  const mine = await ShopUser.findById(me.id).lean();
  assert.ok(mine?.shopJoinedAt, 'not made a Shop customer');
  assert.equal(String(mine.shopReferredBy), String(ravi));
  const log = await ShopReferralLog.findOne({ refereeId: mine._id }).lean();
  assert.equal(log?.status, 'credited');
  assert.equal(log.rewardAmount, 30);
  assert.equal((await ShopUser.findById(ravi).lean()).shopReferralCount, 1);
  assert.equal(await FoodReferralLog.countDocuments({ refereeId: me.id }), 0);
});
await check('past the Shop\'s limit the invite is recorded, not paid', async () => {
  const me = await signUp({ ref: String(ravi), refService: 'shop' }); // his platform id works too
  const log = await ShopReferralLog.findOne({ refereeId: me.id }).lean();
  assert.equal(log?.status, 'rejected');
  assert.equal(log.reason, 'limit_reached');
  assert.equal((await ShopUser.findById(ravi).lean()).shopReferralCount, 1);
});
await check('nothing is redeemed for the Shop while its module is off', async () => {
  await setModuleEnabled('ecommerce', false, { reason: 'test' });
  try {
    const me = await signUp({ ref: String(raviShop), refService: 'shop' });
    assert.ok(!(await ShopUser.findById(me.id).lean())?.shopJoinedAt);
  } finally {
    await setModuleEnabled('ecommerce', true);
  }
});

console.log('\nWho is never paid');
await check('an existing customer signing in again redeems nothing', async () => {
  const phone = '9000000001';
  const { otp } = await requestUserOtp(phone);
  const before = await FoodReferralLog.countDocuments({});
  const out = await verifyUserOtpAndLogin(phone, otp, String(new mongoose.Types.ObjectId()), undefined, undefined, undefined, 'food');
  assert.equal(out.isNewUser, false);
  assert.equal(await FoodReferralLog.countDocuments({}), before);
});
await check('one\'s own Shop code never pays', async () => {
  const { creditShopSignupReferral } = await import('../src/modules/ecommerce/modules/commerce/user/services/userReferral.service.js');
  const res = await creditShopSignupReferral({ refereeId: raviShop, ref: String(ravi) });
  assert.equal(res.credited, false);
});

console.log('\nOne code everywhere');
const { FoodReferralSettings: QuickSettings } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralSettings.model.js');
const { FoodReferralLog: QuickLog } = await import('../src/modules/quickCommerce/modules/food/admin/models/referralLog.model.js');
const { inviteCodeForRow, resolveInviter } = await import('../src/core/referral/inviteCode.service.js');
const { createRequire } = await import('node:module');
const requireCjs = createRequire(import.meta.url);
const spReferral = requireCjs('../src/modules/serviceProvider/services/referralService.js');
const resolver = await import('../src/core/config/resolver.service.js');
await QuickSettings.create({ referralRewardUser: 20, referralLimitUser: 5, isActive: true });
await resolver.set('referral.customerReward', { level: 'vertical', scopeId: 'serviceProvider', value: 50 });
await resolver.set('referral.customerLimit', { level: 'vertical', scopeId: 'serviceProvider', value: 5 });
await setModuleEnabled('quickCommerce', true).catch(() => {});
await setModuleEnabled('serviceProvider', true).catch(() => {});

// Meera shared a Services code before there was one code.
const meera = new mongoose.Types.ObjectId();
await db.collection('users').insertOne({ _id: meera, phone: '9000000002', name: 'Meera', isActive: true });
await db.collection('sp_users').insertOne({ name: 'Meera', phone: '9000000002', platformUserId: meera, referralCode: 'SPABC123', referralCount: 0, wallet: { balance: 0 } });

await check('Ravi\'s one code pays Quick\'s programme through the sign-in (via=quick)', async () => {
  const me = await signUp({ ref: 'USR0001ABCDEF', refService: 'quick' });
  // Quick's customers are platform accounts (the qc_users merge).
  const mine = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(String(me.id)) });
  const his = await db.collection('users').findOne({ _id: ravi });
  assert.ok(mine?.quickJoinedAt && his?.quickJoinedAt, 'both become Quick customers');
  assert.equal(String(mine.quickReferredBy), String(ravi));
  const log = await QuickLog.findOne({ refereeId: mine._id }).lean();
  assert.equal(log?.status, 'credited');
  assert.equal(String(log.referrerId), String(ravi));
});

await check('and Services\' programme (via=services)', async () => {
  // Services customers are platform accounts with a Services profile under the
  // same _id (the sp_users merge); who referred them is spReferredBy.
  const me = await signUp({ ref: 'USR0001ABCDEF', refService: 'services' });
  const myId = new mongoose.Types.ObjectId(String(me.id));
  const mine = await db.collection('sp_profiles').findOne({ _id: myId });
  const his = await db.collection('sp_profiles').findOne({ _id: ravi });
  assert.ok(mine && his, 'both get a Services profile');
  assert.equal(String((await db.collection('users').findOne({ _id: myId })).spReferredBy), String(ravi));
  const log = await db.collection('sp_referral_logs').findOne({ refereeId: myId });
  assert.equal(log?.status, 'credited');
});

await check('an old Services code still names its person, in Food and in the Shop', async () => {
  assert.equal(String(await resolveInviter('spabc123')), String(meera));
  const viaFood = await signUp({ ref: 'SPABC123' });
  assert.equal(String((await FoodReferralLog.findOne({ refereeId: viaFood.id }).lean())?.referrerId), String(meera));
  await signUp({ ref: 'SPABC123', refService: 'shop' });
  const meeraShop = await ShopUser.findById(meera).lean();
  assert.ok(meeraShop?.shopJoinedAt, 'Meera becomes a Shop customer');
  const shopLog = await ShopReferralLog.findOne({ referrerId: meera }).lean();
  assert.equal(shopLog?.status, 'credited');
});

await check('every share screen shows the same code', async () => {
  assert.equal(await inviteCodeForRow('ecom_users', String(raviShop)), 'USR0001ABCDEF');
  assert.equal((await spReferral.referralSummary(ravi)).code, 'USR0001ABCDEF');
  // An old Services row still shows its person's one code.
  const meeraSp = await db.collection('sp_users').findOne({ phone: '9000000002' });
  assert.equal(await inviteCodeForRow('sp_users', String(meeraSp._id)), String(meera));
});

console.log('\nMaster > Referral');
await check('lists the Shop while its module is on, and not when it is off', async () => {
  let { services } = await referralOverview();
  const shop = services.find((s) => s.vertical === 'ecommerce');
  assert.ok(shop, 'no Shop row');
  assert.equal(shop.customerReward.value, 30);
  await setModuleEnabled('ecommerce', false, { reason: 'test' });
  try {
    ({ services } = await referralOverview());
    assert.equal(services.some((s) => s.vertical === 'ecommerce'), false);
  } finally {
    await setModuleEnabled('ecommerce', true);
  }
});

await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
