/**
 * The Shop uses the customer's ONE wallet, shared with Food, Rides and Quick.
 *
 * Run: node tests/one-wallet-shop.smoke.mjs
 *
 * What this guards:
 *   - money added through Food is spendable in the Shop, and a Shop credit
 *     lands in the same wallet Food and Quick read;
 *   - deleting a Shop (or Quick) account leaves the shared wallet untouched;
 *   - a Shop customer with no platform account keeps a wallet of their own;
 *   - scripts/moveShopWallets.mjs moves an old Shop balance once, however
 *     often it runs, and a dry run moves nothing.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';

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
const uri = mongo.getUri('one_wallet_shop');
await mongoose.connect(uri);
const db = mongoose.connection;

const { UserWallet: ShopWallet } = await import('../src/modules/ecommerce/modules/commerce/user/models/userWallet.model.js');
const { FoodUserWallet: QuickWallet } = await import('../src/modules/quickCommerce/modules/food/user/models/userWallet.model.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const shopWalletService = await import('../src/modules/ecommerce/modules/commerce/user/services/userWallet.service.js');
const shopProfile = await import('../src/modules/ecommerce/modules/commerce/user/services/userProfile.service.js');

const oid = () => new mongoose.Types.ObjectId();
const platformId = oid();
const shopId = oid();
const qcId = oid();
await db.collection('users').insertOne({ _id: platformId, name: 'Asha', phone: '9000000001' });
await db.collection('ecom_users').insertOne({ _id: shopId, name: 'Asha', phone: '9000000001', platformUserId: platformId, role: 'USER' });
await db.collection('qc_users').insertOne({ _id: qcId, name: 'Asha', phone: '9000000001', platformUserId: platformId, role: 'USER' });
await CustomerWallet.create({ userId: platformId, balance: 100 });

const sharedBalance = async () => (await CustomerWallet.findOne({ userId: platformId }).lean()).balance;

await check('money added through Food is what the Shop and Quick see', async () => {
    assert.equal((await ShopWallet.findOne({ userId: shopId }).lean()).balance, 100);
    assert.equal((await QuickWallet.findOne({ userId: qcId }).lean()).balance, 100);
});

await check('a Shop credit lands in the one wallet', async () => {
    await shopWalletService.creditReferralReward(String(shopId), 25, { reason: 'test' });
    assert.equal(await sharedBalance(), 125);
    assert.equal(await CustomerWallet.countDocuments({}), 1);
});

await check('deleting the Shop account leaves the shared wallet alone', async () => {
    // The session translates the Shop id first (the ecom_users merge); closing
    // the Shop leaves the shared account and wallet, and leaves the Shop's lists.
    const { resolveShopCustomerId } = await import('../src/core/identity/shopCustomer.js');
    const customerId = await resolveShopCustomerId(String(shopId));
    assert.equal(customerId, String(platformId));
    await shopProfile.deleteCurrentUserAccount(customerId);
    assert.ok(await db.collection('users').findOne({ _id: platformId, shopJoinedAt: null }));
    assert.equal(await sharedBalance(), 125);
});

await check('a Quick delete by its own id never reaches the shared wallet', async () => {
    await QuickWallet.findOneAndDelete({ userId: qcId });
    await QuickWallet.deleteOne({ userId: qcId });
    assert.equal(await sharedBalance(), 125);
});

await check('a Shop customer with no platform account keeps their own wallet', async () => {
    const loneId = oid();
    await db.collection('ecom_users').insertOne({ _id: loneId, name: 'Lone', phone: '9111111199', role: 'USER' });
    await shopWalletService.creditReferralReward(String(loneId), 10, {});
    const own = await db.collection('food_user_wallets').findOne({ userId: loneId });
    assert.equal(own?.balance, 10);
    assert.equal(await sharedBalance(), 125);
});

const runMove = (args = []) => new Promise((resolve, reject) => {
    let out = '';
    const child = spawn(process.execPath, ['scripts/moveShopWallets.mjs', ...args], {
        env: { ...process.env, MONGO_URI: uri },
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out}`))));
});

await check('an old Shop balance moves once: dry run nothing, then once however often it runs', async () => {
    const shop2 = oid();
    // A second, older Shop row of Asha's (another number; the ecom_users merge keeps the first).
    await db.collection('ecom_users').insertOne({ _id: shop2, name: 'Asha', phone: '9000000008', platformUserId: platformId, role: 'USER' });
    await db.collection('ecom_user_wallets').insertOne({ userId: shop2, balance: 50, referralEarnings: 5, transactions: [] });

    const dry = await runMove();
    assert.match(dry, /Would move 1 wallet/);
    assert.equal(await sharedBalance(), 125);

    await runMove(['--apply']);
    assert.equal(await sharedBalance(), 175);
    // Again, and again with the old wallet's mark removed: still paid once.
    await runMove(['--apply']);
    await db.collection('ecom_user_wallets').updateOne({ userId: shop2 }, { $unset: { movedToSharedAt: 1 } });
    await runMove(['--apply']);
    assert.equal(await sharedBalance(), 175);
    const w = await CustomerWallet.findOne({ userId: platformId }).lean();
    assert.equal(w.referralEarnings, 25 + 5); // the earlier Shop referral credit, plus the moved 5
    assert.equal(w.transactions.filter((t) => String(t.referenceKey || '').startsWith('shop-wallet-move:')).length, 1);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop wallet checks passed');
