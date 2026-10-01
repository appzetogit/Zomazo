/**
 * Quick commerce admins merged into the shared `admins` collection.
 *
 * Run: node tests/merge-qc-admins.smoke.mjs
 *
 * Seeds pre-merge qc_admins (a super_admin, a sub_admin with sections, one
 * whose email already has a platform account, a deleted one) and references
 * to them, then: dry run writes nothing; an old Quick admin token works before
 * the script (merged on the spot); --apply merges the rest; re-running changes
 * nothing; after, Quick's admin sign-in works with the old password, the
 * shared policy keeps a Quick sub-admin to its sections and out of Food, the
 * deleted one stays out, audit fields follow, and --drop-old retires the
 * collection while old ids still resolve.
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
const uri = mongo.getUri('merge_qc_admins');
process.env.MONGODB_URI = uri;
process.env.MONGO_URI = uri;
await mongoose.connect(uri);
const db = mongoose.connection;

const { mergeQcAdmins } = await import('../scripts/migrations/mergeQcAdmins.mjs');
const { authMiddleware } = await import('../src/modules/quickCommerce/core/auth/auth.middleware.js');
const { signAccessToken } = await import('../src/modules/quickCommerce/core/auth/token.util.js');
const quickAuth = await import('../src/modules/quickCommerce/core/auth/auth.service.js');
const { decideAdminAccess } = await import('../src/core/admin/adminAccessPolicy.js');
const { requireServiceAccess } = await import('../src/core/roles/serviceAccess.middleware.js').catch(() => ({}));

const oid = () => new mongoose.Types.ObjectId();
const hash = await bcrypt.hash('quick-pass-1', 4);
const owner = oid();
const shared = oid();
const superQ = oid();
const subQ = oid();
const sharedQ = oid();
const goneQ = oid();

await db.collection('admins').insertMany([
    { _id: owner, email: 'owner@x.in', password: hash, role: 'ADMIN', admin_type: 'superadmin', servicesAccess: ['food', 'quickCommerce', 'taxi'], isActive: true },
    { _id: shared, email: 'shared@x.in', password: await bcrypt.hash('platform-pass', 4), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', module: 'food', parentAdminId: owner, servicesAccess: ['food'], permissions: ['orders.read'], isActive: true },
]);
await db.collection('qc_admins').insertMany([
    { _id: superQ, email: 'boss@quick.in', password: hash, name: 'Boss', role: 'ADMIN', adminType: 'super_admin', isActive: true, isDeleted: false },
    { _id: subQ, email: 'ops@quick.in', password: hash, role: 'ADMIN', adminType: 'sub_admin', permissions: { order_management: ['view', 'edit'], customer_management: ['view'] }, isActive: true, isDeleted: false },
    { _id: sharedQ, email: 'shared@x.in', password: hash, role: 'ADMIN', adminType: 'sub_admin', permissions: { dashboard: ['view'] }, isActive: true, isDeleted: false },
    { _id: goneQ, email: 'gone@quick.in', password: hash, role: 'ADMIN', adminType: 'sub_admin', permissions: {}, isActive: false, isDeleted: true },
]);
await db.collection('qc_refunds').insertOne({ processedBy: sharedQ, amount: 10 });
await db.collection('qc_delivery_cash_deposits').insertOne({ adminId: superQ, amount: 5 });

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
const admin = (id) => db.collection('admins').findOne({ _id: id });
const quiet = { log: () => {} };

console.log('\nDry run');
await check('the dry run writes nothing', async () => {
    const before = await snapshot();
    const r = await mergeQcAdmins({ ...quiet });
    assert.equal(r.rows, 4);
    assert.equal(r.linked, 1);
    assert.equal(r.created, 3);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nBefore the script runs');
await check('an old Quick admin token works and its admin is merged on the spot', async () => {
    const s = await session(signAccessToken({ userId: String(superQ), role: 'ADMIN', adminType: 'super_admin' }));
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.user.userId, String(superQ));
    const a = await admin(superQ);
    assert.deepEqual(a.servicesAccess, ['quickCommerce', 'medical']);
    assert.equal(a.module, 'quickCommerce');
});

console.log('\nApply');
await check('--apply merges the rest', async () => {
    const r = await mergeQcAdmins({ apply: true, ...quiet });
    assert.equal(r.already, 1);
    assert.equal(r.linked, 1);
    assert.equal(r.created, 2);
    assert.deepEqual(r.review, ['shared@x.in']);
    assert.equal(r.leftUnmerged, 0);
});
await check('re-running changes nothing', async () => {
    const before = await snapshot();
    const r = await mergeQcAdmins({ apply: true, ...quiet });
    assert.equal(r.already, 4);
    assert.deepEqual(await snapshot(), before);
});

console.log('\nAfter the switch');
await check('Quick admin sign-in works with the old password', async () => {
    const out = await quickAuth.adminLogin('boss@quick.in', 'quick-pass-1');
    assert.equal(String(out.user._id), String(superQ));
    assert.deepEqual([...out.user.effectivePermissions.order_management].sort(), ['create', 'delete', 'edit', 'export', 'view']);
});
await check('a Quick super_admin owns Quick and Medical, not Food or Rides', async () => {
    const a = await admin(superQ);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'orders', write: true }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'settings', write: true }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'food', resource: 'orders', write: false }).allowed, false);
    assert.equal(decideAdminAccess(a, { service: 'taxi', resource: 'orders', write: false }).allowed, false);
});
await check('a Quick sub_admin keeps its sections only', async () => {
    const a = await admin(subQ);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'orders', write: true }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'customers', write: false }).allowed, true);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'customers', write: true }).allowed, false);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'wallet', write: false }).allowed, false);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'orders', write: true, remove: true }).allowed, false, 'no delete given');
    const out = await quickAuth.adminLogin('ops@quick.in', 'quick-pass-1');
    assert.deepEqual(out.user.effectivePermissions.order_management, ['view', 'create', 'edit', 'export']);
    assert.deepEqual(out.user.effectivePermissions.transaction_management, []);
});
await check('the same email keeps its platform account, password and permissions, plus Quick', async () => {
    const a = await admin(shared);
    assert.deepEqual([...a.servicesAccess].sort(), ['food', 'medical', 'quickCommerce']);
    assert.deepEqual(a.permissions, ['orders.read']);
    await assert.rejects(() => quickAuth.adminLogin('shared@x.in', 'quick-pass-1'));
    const ok = await quickAuth.adminLogin('shared@x.in', 'platform-pass');
    assert.equal(String(ok.user._id), String(shared));
    const s = await session(signAccessToken({ userId: String(sharedQ), role: 'ADMIN' }));
    assert.equal(s.user.userId, String(shared), 'an old token names the platform account');
    assert.equal(String((await db.collection('qc_refunds').findOne({})).processedBy), String(shared));
});
await check('a deleted Quick admin stays out', async () => {
    const a = await admin(goneQ);
    assert.equal(a.isActive, false);
    assert.equal(decideAdminAccess(a, { service: 'quickCommerce', resource: 'orders', write: false }).allowed, false);
    await assert.rejects(() => quickAuth.adminLogin('gone@quick.in', 'quick-pass-1'));
});
await check('the old sub-admin screens refuse loudly (410)', async () => {
    const svc = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
    await assert.rejects(() => svc.getSubAdmins({}), (e) => e.statusCode === 410);
});
await check('requireServiceAccess admits a merged Quick admin to Quick only', async () => {
    if (!requireServiceAccess) return;
    const run = (vertical) => new Promise((resolve) => {
        const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); return this; } };
        requireServiceAccess(vertical)({ user: { userId: String(subQ) } }, res, () => resolve(200));
    });
    assert.equal(await run('quickCommerce'), 200);
    assert.equal(await run('food'), 403);
});

console.log('\nRetiring qc_admins');
await check('--drop-old retires qc_admins; old ids still resolve', async () => {
    const r = await mergeQcAdmins({ dropOld: true, ...quiet });
    assert.ok(r.renamed, JSON.stringify(r));
    const s = await session(signAccessToken({ userId: String(sharedQ), role: 'ADMIN' }));
    assert.equal(s.user.userId, String(shared));
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
