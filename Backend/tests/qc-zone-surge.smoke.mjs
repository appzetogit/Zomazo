/**
 * Quick-commerce zone surge: the admin screen saves it, and orders pay it.
 *
 * Run: node tests/qc-zone-surge.smoke.mjs
 *
 * Until this, /qc/admin/delivery/zone-surge answered an empty list so the shared
 * Fee Settings screen would not 500, and saving a surge from the quick-commerce
 * panel went nowhere. What this guards:
 *   - the panel lists its own vertical's zones (quick and medical separately),
 *     saves an amount, and switches it on and off;
 *   - a quote in a surged zone carries the surge in its total, and nothing when
 *     the surge is off;
 *   - the rider is paid the surge and the platform does not book it as a loss.
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('qc_zone_surge');
await mongoose.connect(mongo.getUri('qc_zone_surge'));

const BASE = '../src/modules/quickCommerce/modules/food';
const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { MedicalZone } = await import(`${BASE}/admin/models/medicalZone.model.js`);
const { QCDeliverySurgeZone } = await import(`${BASE}/admin/models/deliverySurgeZone.model.js`);
const { calculateOrderPricing } = await import(`${BASE}/orders/services/order-pricing.service.js`);
const { createInitialTransaction } = await import(`${BASE}/orders/services/foodTransaction.service.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

const owner = await FoodAdmin.create({
    email: 'owner@x.in', password: 'secret1', name: 'Owner', adminLevel: 'platform_superadmin',
    admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'medical', 'taxi'],
});
const token = signAccessToken({ userId: String(owner._id), sub: String(owner._id), role: 'ADMIN' });
const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
};

const square = [
    { latitude: 12.0, longitude: 77.0 }, { latitude: 12.0, longitude: 78.0 },
    { latitude: 13.0, longitude: 78.0 }, { latitude: 13.0, longitude: 77.0 },
];
const zoneDoc = (name) => ({ name, zoneName: name, isActive: true, coordinates: square });
const quickZone = await QCZone.collection.insertOne(zoneDoc('Quick Central'));
const medicalZone = await MedicalZone.collection.insertOne(zoneDoc('Medical Central'));
const quickZoneId = String(quickZone.insertedId);
const medicalZoneId = String(medicalZone.insertedId);

console.log('\n[1] the admin screen');

await check('the quick panel lists its own zones, surge off', async () => {
    const r = await call('GET', '/v1/qc/admin/delivery/zone-surge?vertical=quick');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ids = r.json.data.surgeConfigs.map((c) => String(c.zoneId));
    assert.deepEqual(ids, [quickZoneId]);
    assert.equal(r.json.data.surgeConfigs[0].isEnabled, false);
});

await check('the medical panel lists medical zones, not quick ones', async () => {
    const r = await call('GET', '/v1/qc/admin/delivery/zone-surge?vertical=medical');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.surgeConfigs.map((c) => String(c.zoneId)), [medicalZoneId]);
});

await check('saving a surge on a quick zone is kept', async () => {
    const r = await call('PUT', '/v1/qc/admin/delivery/zone-surge', {
        zoneId: quickZoneId, surgeAmount: 25.456, isEnabled: true, vertical: 'quick',
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.surgeConfig.surgeAmount, 25.46);
    const list = await call('GET', '/v1/qc/admin/delivery/zone-surge?vertical=quick');
    assert.equal(list.json.data.surgeConfigs[0].isEnabled, true);
    assert.equal(list.json.data.surgeConfigs[0].surgeAmount, 25.46);
});

await check('a quick zone cannot be saved through the medical panel', async () => {
    const r = await call('PUT', '/v1/qc/admin/delivery/zone-surge', {
        zoneId: quickZoneId, surgeAmount: 5, vertical: 'medical',
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
});

await check('a negative amount is refused', async () => {
    const r = await call('PUT', '/v1/qc/admin/delivery/zone-surge', { zoneId: quickZoneId, surgeAmount: -1 });
    assert.equal(r.status, 400);
});

await check('the status switch turns it off and on', async () => {
    const off = await call('PATCH', `/v1/qc/admin/delivery/zone-surge/${quickZoneId}/status`, { status: false, vertical: 'quick' });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(off.json.data.surgeConfig.isEnabled, false);
    const on = await call('PATCH', `/v1/qc/admin/delivery/zone-surge/${quickZoneId}/status`, { status: true, vertical: 'quick' });
    assert.equal(on.json.data.surgeConfig.isEnabled, true);
});

console.log('\n[2] orders pay it');

const restaurantId = new mongoose.Types.ObjectId();
const restaurant = {
    _id: restaurantId,
    restaurantName: 'Corner Kirana',
    status: 'approved',
    zoneId: quickZone.insertedId,
    location: { type: 'Point', coordinates: [77.6, 12.9], latitude: 12.9, longitude: 77.6 },
};
const deliveryAddress = {
    street: '1 MG Road', city: 'Bengaluru', state: 'KA',
    location: { type: 'Point', coordinates: [77.61, 12.91] },
};
await FoodFeeSettings.create({ deliveryFee: 0, deliveryFeeRanges: [], platformFee: 0, gstRate: 0, isActive: true });
const rice = await FoodItem.create({ restaurantId, name: 'Rice 1kg', price: 100, gstRate: 0, approvalStatus: 'approved' });
const quote = () => calculateOrderPricing(String(new mongoose.Types.ObjectId()), {
    restaurantId: String(restaurantId),
    items: [{ itemId: String(rice._id), quantity: 1, price: 100 }],
    deliveryAddress,
}, { restaurant, skipAvailabilityCheck: true });

await check('a quote in the surged zone adds the surge to the total', async () => {
    const { pricing } = await quote();
    assert.equal(pricing.surgeAmount, 25.46);
    assert.equal(pricing.total, 125.46, `total ${pricing.total}`);
});

await check('with the surge off the quote charges none', async () => {
    await QCDeliverySurgeZone.updateOne({ zoneId: quickZone.insertedId }, { $set: { isEnabled: false } });
    const { pricing } = await quote();
    assert.equal(pricing.surgeAmount, 0);
    assert.equal(pricing.total, 100);
    await QCDeliverySurgeZone.updateOne({ zoneId: quickZone.insertedId }, { $set: { isEnabled: true } });
});

await check('the rider is paid the surge and the platform nets nothing on it', async () => {
    const order = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        restaurantId,
        pricing: { subtotal: 100, deliveryFee: 30, platformFee: 0, surgeAmount: 25.46, tax: 0, total: 155.46 },
        riderEarning: 30 + 25.46,
        riderSurgePay: 25.46,
        payment: { method: 'cash', status: 'cod_pending' },
    };
    const tx = await createInitialTransaction(order);
    assert.equal(tx.pricing.surgeAmount, 25.46);
    assert.equal(tx.amounts.riderShare, 55.46);
    // Delivery fee 30 fully paid out, surge passed through: nothing left over.
    assert.equal(tx.amounts.platformNetProfit, 0, `net ${tx.amounts.platformNetProfit}`);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
