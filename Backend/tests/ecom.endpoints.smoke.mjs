// E-commerce (Shop) inside the platform: identity bridge, admin gate, and a
// sweep of every GET endpoint the module exposes, failing on any 5xx.
//
// The module is a port of a standalone app. What this pins:
//   - a customer's ONE platform login works here, and their first request makes
//     a linked ecom_users satellite (never a second account for the same phone);
//   - the module's own customer / admin / rider logins are gone -- they would
//     be a second front door around the platform identity and servicesAccess;
//   - a platform admin reaches the panel only with 'ecommerce' access, except the
//     platform superadmin, whose explicit servicesAccess predates this vertical;
//   - a controller that references an unimported symbol or an unregistered model
//     500s only when that endpoint is hit, so all of them are hit.
//
// 4xx during the sweep is fine (no fixtures, not-found ids). 5xx is a bug.
//
// Run: node tests/ecom.endpoints.smoke.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const OID = '000000000000000000000001';

/** Recursively collect GET paths from an express router stack. */
const collectGetPaths = (stack, prefix = '') => {
    const out = [];
    for (const layer of stack) {
        if (layer.route) {
            if (layer.route.methods?.get) out.push(prefix + layer.route.path);
            continue;
        }
        if (layer.name === 'router' && layer.handle?.stack) {
            let mount = '';
            const src = layer.regexp?.source ?? '';
            if (src !== '^\\/?(?=\\/|$)') {
                mount = src
                    .replace(/^\^/, '')
                    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
                    .replace(/\$$/, '')
                    .replace(/\\\//g, '/');
            }
            out.push(...collectGetPaths(layer.handle.stack, prefix + mount));
        }
    }
    return out;
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.NODE_ENV = 'test';
// One customer token walks ~150 endpoints; at the default 100 per window the
// tail of the sweep answered 429 and was never actually exercised.
process.env.RATE_LIMIT_MAX = '100000';
await mongoose.connect(process.env.MONGO_URI);

const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { FoodUser: PlatformUser } = await import('../src/core/users/user.model.js');
// Old Shop rows; customers are platform accounts since the ecom_users merge.
const { LegacyEcomUser: EcomUser } = await import('../src/modules/ecommerce/core/users/user.model.js');
const { Seller } = await import('../src/modules/ecommerce/modules/commerce/seller/models/seller.model.js');
const { default: ecomRouter } = await import('../src/modules/ecommerce/routes/index.js');

const server = app.listen(0);
const port = server.address().port;

const call = (path, method = 'GET', body = null, token = null) =>
    new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const headers = {};
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });

let failures = 0;
const check = (name, fn) => {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${name}: ${err.message}`);
    }
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const customer = await PlatformUser.create({ phone: '+91 98765 43210', name: 'Shop Customer', role: 'USER' });
const customerToken = signAccessToken({ userId: String(customer._id), role: 'USER' });

const owner = await FoodAdmin.create({
    email: 'owner@test.local', password: 'Passw0rd!', name: 'Owner', isActive: true,
    role: 'ADMIN', admin_type: 'superadmin', adminLevel: 'platform_superadmin', permissions: ['*'],
    // An owner made before this vertical existed: explicit list, no 'ecommerce'.
    servicesAccess: ['food', 'quickCommerce', 'medical', 'taxi', 'serviceProvider'],
});
const ownerToken = signAccessToken({ userId: String(owner._id), role: 'ADMIN' });

const foodOnly = await FoodAdmin.create({
    email: 'food@test.local', password: 'Passw0rd!', name: 'Food only', isActive: true,
    role: 'ADMIN', admin_type: 'subadmin', adminLevel: 'subadmin', parentAdminId: owner._id,
    permissions: ['orders.read'], servicesAccess: ['food'],
});
const foodOnlyToken = signAccessToken({ userId: String(foodOnly._id), role: 'ADMIN' });

const shopAdmin = await FoodAdmin.create({
    email: 'shop@test.local', password: 'Passw0rd!', name: 'Shop sub-admin', isActive: true,
    role: 'ADMIN', admin_type: 'subadmin', adminLevel: 'subadmin', parentAdminId: owner._id,
    permissions: ['orders.read'], servicesAccess: ['ecommerce'],
});
const shopAdminToken = signAccessToken({ userId: String(shopAdmin._id), role: 'ADMIN' });

// Inserted raw: the seller schema requires a full onboarding record, and the
// gates under test only read status and tokenVersion.
const sellerId = new mongoose.Types.ObjectId();
await Seller.collection.insertOne({
    _id: sellerId, ownerPhone: '9123456780', ownerPhoneDigits: '9123456780',
    sellerName: 'Test Store', status: 'approved', tokenVersion: 0, isActive: true,
});
const sellerToken = signAccessToken({ userId: String(sellerId), role: 'SELLER', tokenVersion: 0 });

// ── Identity bridge ─────────────────────────────────────────────────────────
console.log('\nidentity bridge');
const profile = await call('/api/v1/ecom/user/profile', 'GET', null, customerToken);
const satellites = [customer];
check('platform customer token is accepted', () => assert.equal(profile.status, 200, profile.body.slice(0, 200)));
const shopRows = await EcomUser.countDocuments();
const joined = (await PlatformUser.findById(customer._id).lean())?.shopJoinedAt;
check('the first request makes no second account, only marks a Shop customer', () => {
    assert.equal(shopRows, 0);
    assert.ok(joined);
});

const taxiShaped = signAccessToken({ sub: String(new mongoose.Types.ObjectId()), role: 'user' });
const stranger = await call('/api/v1/ecom/user/profile', 'GET', null, taxiShaped);
check('a token for no real customer is refused', () => assert.equal(stranger.status, 401));

const browse = await call('/api/v1/ecom/catalog/products', 'GET', null, signAccessToken({
    userId: String((await PlatformUser.create({ phone: '9000000001', role: 'USER' }))._id), role: 'USER',
}));
const afterBrowse = await EcomUser.countDocuments();
const browsedShopJoin = (await PlatformUser.findOne({ phone: '9000000001' }).lean())?.shopJoinedAt;
check('browsing while signed in does not make anyone a Shop customer', () => {
    assert.ok(browse.status < 500, browse.body.slice(0, 200));
    assert.equal(afterBrowse, 0);
    assert.ok(!browsedShopJoin);
});

// ── Front doors that must be closed ─────────────────────────────────────────
console.log('\nremoved logins and routes');
for (const path of ['/auth/user/request-otp', '/auth/admin/login', '/auth/delivery/request-otp']) {
    const res = await call(`/api/v1/ecom${path}`, 'POST', { phone: '9876543210', email: 'x@y.z', password: 'x' });
    check(`POST ${path} is gone`, () => assert.equal(res.status, 404));
}
const riders = await call('/api/v1/ecom/delivery/orders/current', 'GET', null, customerToken);
check('the rider API is not mounted', () => assert.equal(riders.status, 404));
// An empty body: proves the route is mounted (validation answers, not 404)
// without asking the SMS provider to text anyone.
const sellerOtp = await call('/api/v1/ecom/auth/seller/request-otp', 'POST', {});
check('seller OTP login is still there', () => assert.ok(sellerOtp.status !== 404 && sellerOtp.status < 500, `${sellerOtp.status} ${sellerOtp.body.slice(0, 120)}`));

// ── Admin gate ──────────────────────────────────────────────────────────────
console.log('\nadmin gate');
const ownerRes = await call('/api/v1/ecom/admin/orders', 'GET', null, ownerToken);
check('platform owner (list predates ecommerce) is admitted', () => assert.ok(ownerRes.status < 400, `${ownerRes.status} ${ownerRes.body.slice(0, 200)}`));
const shopRes = await call('/api/v1/ecom/admin/orders', 'GET', null, shopAdminToken);
check('sub-admin with ecommerce access is admitted', () => assert.ok(shopRes.status < 400, `${shopRes.status} ${shopRes.body.slice(0, 200)}`));
const foodRes = await call('/api/v1/ecom/admin/orders', 'GET', null, foodOnlyToken);
check('food-only sub-admin is refused', () => assert.equal(foodRes.status, 403));
const custAdmin = await call('/api/v1/ecom/admin/orders', 'GET', null, customerToken);
check('a customer is refused', () => assert.equal(custAdmin.status, 403));

// ── The platform's own screens see the Shop ─────────────────────────────────
// Master Platform Earnings, Commission Overview and Coupons, and the customer's
// cross-service My Orders, each read the Shop's collections directly. One
// delivered order with its money split, and one coupon, must show in all four.
console.log('\nmaster reports');
{
    const satellite = satellites[0];
    const orderId = new mongoose.Types.ObjectId();
    const conn = mongoose.connection;
    await conn.collection('ecom_orders').insertOne({
        _id: orderId, orderId: 'ORD-SMOKE-1', userId: satellite._id, sellerId,
        orderStatus: 'delivered', fulfilmentMode: 'standard',
        items: [{ name: 'Ceramic Mug', quantity: 2, price: 250 }],
        pricing: { subtotal: 500, total: 500 }, createdAt: new Date(), updatedAt: new Date(),
    });
    await conn.collection('ecom_order_transactions').insertOne({
        orderId, userId: satellite._id, sellerId, paymentMethod: 'razorpay', status: 'captured',
        pricing: { subtotal: 500, platformFee: 0, deliveryFee: 0, total: 500 },
        amounts: { totalCustomerPaid: 500, sellerShare: 450, sellerCommission: 50, riderShare: 0, platformNetProfit: 50, taxAmount: 0 },
        createdAt: new Date(),
    });
    await conn.collection('ecom_offers').insertOne({
        couponCode: 'SHOPSMOKE', discountType: 'percentage', discountValue: 10, status: 'active',
        sellerScope: 'all', createdByRole: 'ADMIN', usedCount: 0, createdAt: new Date(),
    });

    const pnl = JSON.parse((await call('/api/v1/platform/pnl', 'GET', null, ownerToken)).body);
    const shopPnl = (pnl.data?.services || pnl.services || []).find((s) => s.key === 'shop');
    check('Platform Earnings has a Shop line with the order', () => {
        assert.ok(shopPnl, JSON.stringify(pnl).slice(0, 200));
        assert.equal(shopPnl.count, 1);
        assert.equal(shopPnl.net, 50);
    });

    const com = JSON.parse((await call('/api/v1/platform/commission', 'GET', null, ownerToken)).body);
    const shopCom = (com.data?.services || com.services || []).find((s) => s.key === 'shop');
    const row = shopCom?.rows?.find((r) => r.id === String(sellerId));
    check('Commission Overview lists the Shop seller and what it paid', () => {
        assert.ok(row, JSON.stringify(com).slice(0, 200));
        assert.equal(row.last30.commission, 50);
        assert.equal(row.source, 'category');
    });

    const cps = JSON.parse((await call('/api/v1/platform/coupons?source=shop', 'GET', null, ownerToken)).body);
    const items = cps.data?.items || cps.items || [];
    check('Master Coupons lists the Shop coupon', () => assert.ok(items.some((c) => c.code === 'SHOPSMOKE' && c.source === 'shop'), JSON.stringify(cps).slice(0, 200)));

    const mine = JSON.parse((await call('/api/v1/platform/me/orders', 'GET', null, customerToken)).body);
    const rows = mine.data?.items || mine.items || [];
    check("the customer's My Orders includes the Shop order", () => {
        const shopRow = rows.find((r) => r.service === 'shop');
        assert.ok(shopRow, JSON.stringify(mine).slice(0, 200));
        assert.equal(shopRow.route, `/shop/orders/${orderId}`);
        assert.equal(shopRow.title, 'Test Store');
    });
}

// ── Scheduled jobs ──────────────────────────────────────────────────────────
// They run in-process from server.js; a broken import in one only ever shows up
// as a log line at runtime, so each is run once here.
console.log('\nscheduled jobs');
const { runEcomJobsOnce } = await import('../src/modules/ecommerce/jobs/scheduler.js');
let jobError = null;
try { await runEcomJobsOnce(); } catch (err) { jobError = err; }
check('every e-commerce job runs', () => assert.equal(jobError, null, jobError?.message));

// ── Sweep ───────────────────────────────────────────────────────────────────
console.log('\nGET sweep');
const paths = [...new Set(collectGetPaths(ecomRouter.stack))]
    .filter((p) => p && !p.includes('*'))
    .map((p) => p.replace(/:[A-Za-z0-9_]+/g, OID))
    .sort();

const tokenFor = (p) => {
    if (p.startsWith('/admin')) return ownerToken;
    if (p.startsWith('/seller')) return sellerToken;
    return customerToken;
};

const serverErrors = [];
let ok = 0;
let clientErr = 0;
for (const p of paths) {
    const res = await call(`/api/v1/ecom${p}`, 'GET', null, tokenFor(p));
    if (res.status >= 500) serverErrors.push(`${p} -> ${res.status} ${res.body.slice(0, 160)}`);
    else if (res.status < 400) ok++;
    else clientErr++;
}

console.log(`  swept ${paths.length} GET endpoints: ${ok} ok, ${clientErr} 4xx, ${serverErrors.length} 5xx`);
if (serverErrors.length) {
    console.log('\n--- SERVER ERRORS ---');
    serverErrors.forEach((e) => console.log('  ' + e));
    failures += serverErrors.length;
}
if (paths.length < 100) {
    console.log(`  FAIL only ${paths.length} routes discovered; the walker is broken`);
    failures += 1;
}

server.close();
await mongoose.disconnect();
await mongod.stop();

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
process.exit(failures === 0 ? 0 : 1);
