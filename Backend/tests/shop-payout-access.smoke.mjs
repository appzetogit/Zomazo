/**
 * Only the Shop's admins reach the Shop's payment admin routes.
 *
 * Run: node tests/shop-payout-access.smoke.mjs
 */
import assert from 'node:assert/strict';
import express from 'express';
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
process.env.MONGODB_URI = mongo.getUri('shop_payout_access');
await mongoose.connect(mongo.getUri('shop_payout_access'));

const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { setModuleEnabled } = await import('../src/core/modules/moduleState.service.js').catch(() => ({}));
if (setModuleEnabled) await setModuleEnabled('ecommerce', true).catch(() => {});

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

const tokenFor = (admin) => signAccessToken({ userId: String(admin._id), sub: String(admin._id), role: 'ADMIN' });
const owner = await FoodAdmin.create({
    email: 'owner@x.in', password: 'secret1', name: 'Owner', adminLevel: 'platform_superadmin',
    admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'ecommerce'],
});
// A sub-admin as the admin screens make one: under the owner, for Food. (An
// admin with no parent and no module is a pre-hierarchy owner by design --
// adminHierarchy.service.js -- so it would rightly pass.)
const foodOnly = await FoodAdmin.create({
    email: 'food@x.in', password: 'secret1', name: 'Food admin', parentAdminId: owner._id, module: 'food',
    admin_type: 'subadmin', permissions: ['*'], servicesAccess: ['food'],
});
const call = async (method, path, admin, body) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${tokenFor(admin)}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.status;
};

await check('a Food-only admin cannot list or create Shop payouts', async () => {
    assert.equal(await call('GET', '/v1/ecom/payments/admin/settlements', foodOnly), 403);
    assert.equal(await call('POST', '/v1/ecom/payments/admin/settlements', foodOnly, { entityType: 'seller', entityId: String(new mongoose.Types.ObjectId()), amount: 5000 }), 403);
});

await check('the platform owner still reaches them', async () => {
    const status = await call('GET', '/v1/ecom/payments/admin/settlements', owner);
    assert.notEqual(status, 403, `got ${status}`);
    assert.notEqual(status, 401, `got ${status}`);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop payout access checks passed');
