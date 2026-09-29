/**
 * A platform sub-admin given the Shop reaches only the Shop sections they were given.
 *
 * Run: node tests/shop-subadmin-scope.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('shop_subadmin_scope');
await mongoose.connect(mongo.getUri('shop_subadmin_scope'));

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
// A Shop sub-admin given orders, read-only.
const ordersReader = await FoodAdmin.create({
    email: 'shop@x.in', password: 'secret1', name: 'Shop admin', parentAdminId: owner._id,
    admin_type: 'subadmin', adminLevel: 'subadmin', permissions: ['orders.read'], servicesAccess: ['ecommerce'],
});
const call = async (method, path, admin, body) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${tokenFor(admin)}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.status;
};

await check('a sub-admin given Shop orders can read them', async () => {
    const status = await call('GET', '/v1/ecom/admin/orders', ordersReader);
    assert.notEqual(status, 403, `got ${status}`);
    assert.notEqual(status, 401, `got ${status}`);
});

await check('but not change them, nor open sections they were not given', async () => {
    const id = String(new mongoose.Types.ObjectId());
    assert.equal(await call('PATCH', `/v1/ecom/admin/orders/${id}/status`, ordersReader, { status: 'cancelled' }), 403);
    assert.equal(await call('GET', '/v1/ecom/admin/reports/tax', ordersReader), 403);
    assert.equal(await call('GET', '/v1/ecom/admin/sub-admins', ordersReader), 403);
    assert.equal(await call('POST', '/v1/ecom/admin/offers', ordersReader, { code: 'X' }), 403);
    assert.equal(await call('PATCH', '/v1/ecom/admin/coins/settings', ordersReader, {}), 403);
});

await check('the platform owner still reaches those sections', async () => {
    for (const path of ['/v1/ecom/admin/reports/tax', '/v1/ecom/admin/sub-admins']) {
        const status = await call('GET', path, owner);
        assert.notEqual(status, 403, `${path} got ${status}`);
        assert.notEqual(status, 401, `${path} got ${status}`);
    }
});

server.close();
await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop sub-admin scope checks passed');
