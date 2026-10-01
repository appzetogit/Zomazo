/**
 * Shop admins merged into the shared `admins` collection.
 *
 * Run: node tests/merge-ecom-admins.smoke.mjs
 *
 * Seeds pre-merge ecom_admins (a super_admin, a sub_admin with sections, one
 * whose email already has a platform account, a deleted one), then: dry run
 * writes nothing; an old Shop admin token works before the script (merged on
 * the spot); --apply merges the rest (REVIEW lists the shared email);
 * re-running changes nothing; after, the shared policy keeps a Shop sub-admin
 * to its sections and out of other panels, the Shop's sub-admin screens
 * create and edit platform admins in the old shape, and --drop-old retires
 * the collection while old ids still resolve.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
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
const uri = mongo.getUri('merge_ecom_admins');
process.env.MONGODB_URI = uri;
process.env.MONGO_URI = uri;
await mongoose.connect(uri);
const db = mongoose.connection;

const { mergeEcomAdmins } = await import('../scripts/migrations/mergeEcomAdmins.mjs');
const { authMiddleware } = await import('../src/modules/ecommerce/core/auth/auth.middleware.js');
const { signAccessToken } = await import('../src/modules/ecommerce/core/auth/token.util.js');
const shopAuth = await import('../src/modules/ecommerce/core/auth/auth.service.js');
const shopAdminSvc = await import('../src/modules/ecommerce/modules/commerce/admin/services/admin.service.js');
const { decideAdminAccess } = await import('../src/core/admin/adminAccessPolicy.js');
const { requireServiceAccess } = await import('../src/core/roles/serviceAccess.middleware.js');

const oid = () => new mongoose.Types.ObjectId();
const hash = await bcrypt.hash('shop-pass-1', 4);
const owner = oid();
const shared = oid();
const superS = oid();
const subS = oid();
const sharedS = oid();
const goneS = oid();

await db.collection('admins').insertMany([
    { _id: owner, email: 'owner@x.in', password: hash, role: 'ADMIN', admin_type: 'superadmin', servicesAccess: ['food', 'quickCommerce', 'taxi'], isActive: true },
    { _id: shared, email: 'shared@x.in', password: await bcrypt.hash('platform-pass', 4), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', module: 'food', parentAdminId: owner, servicesAccess: ['food'], permissions: ['orders.read'], isActive: true },
]);
await db.collection('ecom_admins').insertMany([
    { _id: superS, email: 'boss@shop.in', password: hash, name: 'Boss', role: 'ADMIN', adminType: 'super_admin', isActive: true, isDeleted: false },
    { _id: subS, email: 'ops@shop.in', password: hash, role: 'ADMIN', adminType: 'sub_admin', permissions: { order_management: ['view', 'edit'], product_management: ['view'] }, isActive: true, isDeleted: false },
    { _id: sharedS, email: 'shared@x.in', password: hash, role: 'ADMIN', adminType: 'sub_admin', permissions: { dashboard: ['view'] }, isActive: true, isDeleted: false },
    { _id: goneS, email: 'gone@shop.in', password: hash, role: 'ADMIN', adminType: 'sub_admin', permissions: {}, isActive: false, isDeleted: true },
]);
await db.collection('ecom_refunds').insertOne({ processedBy: sharedS, amount: 10 });

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
const access = (vertical, userId) => new Promise((resolve) => {
    const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); return this; } };
    requireServiceAccess(vertical)({ user: { userId: String(userId) } }, res, () => resolve(200));
});
const admin = (id) => db.collection('admins').findOne({ _id: id });
const quiet = { log: () => {} };

console.log('\nDry run');
await check('the dry run writes nothing', async () => {
    const before = await snapshot();
    const r = await mergeEcomAdmins({ ...quiet });
    assert.equal(r.rows, 4);
    assert.equal(r.linked, 1);
    assert.equal(r.created, 3);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nBefore the script runs');
await check('an old Shop admin token works and its admin is merged on the spot', async () => {
    const s = await session(signAccessToken({ userId: String(superS), role: 'ADMIN' }));
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.user.userId, String(superS));
    const a = await admin(superS);
    assert.deepEqual(a.servicesAccess, ['ecommerce']);
    assert.equal(a.module, 'ecommerce');
});

console.log('\nApply');
await check('--apply merges the rest; the shared email is listed for review', async () => {
    const r = await mergeEcomAdmins({ apply: true, ...quiet });
    assert.equal(r.already, 1);
    assert.equal(r.linked, 1);
    assert.equal(r.created, 2);
    assert.deepEqual(r.review, ['shared@x.in']);
    assert.equal(r.leftUnmerged, 0);
});
await check('re-running changes nothing', async () => {
    const before = await snapshot();
    const r = await mergeEcomAdmins({ apply: true, ...quiet });
    assert.equal(r.already, 4);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nAfter the switch');
await check('a Shop super_admin owns the Shop and nothing else', async () => {
    const a = await admin(superS);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'orders', write: true }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'settings', write: true }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'food', resource: 'orders', write: false }).allowed, false);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'orders', write: false }).allowed, false);
    assert.equal(await access('ecommerce', superS), 200);
    assert.equal(await access('food', superS), 403);
});
await check('a Shop sub_admin keeps its sections only', async () => {
    const a = await admin(subS);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'orders', write: true }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'foods', write: false }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'foods', write: true }).allowed, false);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'wallet', write: false }).allowed, false);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'orders', write: true, remove: true }).allowed, false);
    const profile = await shopAuth.getProfile(String(subS), 'ADMIN');
    assert.deepEqual(profile.user?.effectivePermissions?.order_management || profile.effectivePermissions?.order_management, ['view', 'create', 'edit', 'export']);
});
await check('the same email keeps its platform account and permissions, plus the Shop', async () => {
    const a = await admin(shared);
    assert.deepEqual([...a.servicesAccess].sort(), ['ecommerce', 'food']);
    assert.deepEqual(a.permissions, ['orders.read']);
    assert.equal(await bcrypt.compare('platform-pass', a.password), true);
    const s = await session(signAccessToken({ userId: String(sharedS), role: 'ADMIN' }));
    assert.equal(s.user.userId, String(shared));
    assert.equal(String((await db.collection('ecom_refunds').findOne({})).processedBy), String(shared));
});
await check('a deleted Shop admin stays out', async () => {
    const a = await admin(goneS);
    assert.equal(a.isActive, false);
    assert.equal(decideAdminAccess(a, { service: 'ecommerce', resource: 'orders', write: false }).allowed, false);
});
await check('the Shop\'s sub-admin screens manage platform admins in the old shape', async () => {
    const made = await shopAdminSvc.createSubAdmin({ email: 'new@shop.in', password: 'Str0ng!Passw0rd', name: 'New' }, String(superS));
    assert.equal(made.adminType, 'sub_admin');
    const raw = await db.collection('admins').findOne({ email: 'new@shop.in' });
    assert.deepEqual(raw.servicesAccess, ['ecommerce']);
    assert.equal(String(raw.parentAdminId), String(superS));
    assert.notEqual(raw.password, 'Str0ng!Passw0rd', 'hashed');
    const edited = await shopAdminSvc.updateSubAdminPermissions(String(raw._id), { order_management: ['view'] });
    assert.deepEqual(edited.permissions.order_management, ['view', 'export']);
    assert.deepEqual((await admin(raw._id)).permissions, ['orders.read']);
    const list = await shopAdminSvc.getSubAdmins({});
    assert.ok(list.items.some((i) => i.email === 'new@shop.in'));
    assert.ok(list.items.some((i) => i.email === 'ops@shop.in'), 'merged sub-admins are listed');
    assert.ok(!list.items.some((i) => i.email === 'shared@x.in'), 'a Food sub-admin is not the Shop\'s');
    await shopAdminSvc.deleteSubAdmin(String(raw._id));
    assert.equal((await admin(raw._id)).isActive, false);
    assert.ok(!(await shopAdminSvc.getSubAdmins({})).items.some((i) => i.email === 'new@shop.in'));
});

console.log('\nRetiring ecom_admins');
await check('--drop-old retires ecom_admins; old ids still resolve', async () => {
    const r = await mergeEcomAdmins({ dropOld: true, ...quiet });
    assert.ok(r.renamed, JSON.stringify(r));
    const s = await session(signAccessToken({ userId: String(sharedS), role: 'ADMIN' }));
    assert.equal(s.user.userId, String(shared));
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
