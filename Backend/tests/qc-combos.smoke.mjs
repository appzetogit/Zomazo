/**
 * Quick-commerce combos: several of a store's products sold together at one
 * price, on food's rules, with stock taken from (and given back to) the parts.
 *
 * Run: node tests/qc-combos.smoke.mjs
 *
 * What this guards:
 *   - a seller creates a combo (priced below its parts, MRP = the parts total),
 *     and it waits for approval like any product;
 *   - a combo cannot contain another combo, or be priced at or above its parts;
 *   - a quote charges the combo price and carries its parts on the line;
 *   - reserving an order takes the PARTS' stock, and cancelling gives it back;
 *   - a part running out takes the combo off sale; restocking brings it back;
 *   - food's combos are not quick's.
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
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('qc_combos');
await mongoose.connect(mongo.getUri('qc_combos'));

const BASE = '../src/modules/quickCommerce/modules/food';
const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
const { calculateOrderPricing } = await import(`${BASE}/orders/services/order-pricing.service.js`);
const { reserveStockForItems, restoreOrderStock, syncAvailability } = await import(`${BASE}/orders/services/inventory.service.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const foodCombos = await import('../src/modules/food/shared/combo.service.js');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

const zone = await QCZone.collection.insertOne({
    name: 'Central', zoneName: 'Central', isActive: true,
    coordinates: [
        { latitude: 12.0, longitude: 77.0 }, { latitude: 12.0, longitude: 78.0 },
        { latitude: 13.0, longitude: 78.0 }, { latitude: 13.0, longitude: 77.0 },
    ],
});
const store = await FoodRestaurant.collection.insertOne({
    restaurantName: 'Corner Kirana', status: 'approved', isActive: true, zoneId: zone.insertedId, ownerPhone: '9111111111',
    location: { type: 'Point', coordinates: [77.6, 12.9], latitude: 12.9, longitude: 77.6 },
});
const restaurantId = store.insertedId;
const restaurant = await FoodRestaurant.findById(restaurantId).lean();
await FoodFeeSettings.create({ deliveryFee: 0, deliveryFeeRanges: [], platformFee: 0, gstRate: 0, isActive: true });

const milk = await FoodItem.create({ restaurantId, name: 'Milk', price: 30, gstRate: 0, approvalStatus: 'approved', stockQty: 10 });
const bread = await FoodItem.create({ restaurantId, name: 'Bread', price: 50, gstRate: 0, approvalStatus: 'approved', stockQty: 10 });

const token = signAccessToken({ userId: String(restaurantId), sub: String(restaurantId), role: 'RESTAURANT' });
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
const parts = [{ itemId: String(milk._id), quantity: 2 }, { itemId: String(bread._id), quantity: 1 }];
const stockOf = async (doc) => (await FoodItem.findById(doc._id).lean()).stockQty;

let combo;
console.log('\n[1] the seller makes one');

await check('2 milk + 1 bread (Rs.110 of parts) for Rs.99: saved, pending, MRP = parts', async () => {
    const r = await call('POST', '/v1/qc/restaurant/combos', { name: 'Breakfast pack', components: parts, comboPrice: 99 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    combo = r.json.data.combo;
    assert.equal(combo.isCombo, true);
    assert.equal(combo.price, 99);
    assert.equal(combo.mrp, 110);
    assert.equal(combo.approvalStatus, 'pending');
    assert.equal(combo.stockQty, null);
    const list = await call('GET', '/v1/qc/restaurant/combos');
    assert.equal(list.json.data.combos.length, 1);
});

await check('a combo inside a combo, or one priced at its parts, is refused', async () => {
    const nested = await call('POST', '/v1/qc/restaurant/combos', {
        name: 'Nested', components: [{ itemId: combo._id, quantity: 1 }, { itemId: String(milk._id), quantity: 1 }], comboPrice: 100,
    });
    assert.equal(nested.status, 400);
    const pricey = await call('POST', '/v1/qc/restaurant/combos', { name: 'No saving', components: parts, comboPrice: 110 });
    assert.equal(pricey.status, 400);
});

console.log('\n[2] orders');
await FoodItem.updateOne({ _id: combo._id }, { $set: { approvalStatus: 'approved' } });

let pricedItems;
await check('a quote charges the combo price and carries its parts', async () => {
    const { items, pricing } = await calculateOrderPricing(String(new mongoose.Types.ObjectId()), {
        restaurantId: String(restaurantId),
        items: [{ itemId: String(combo._id), quantity: 2, price: 99 }],
        deliveryAddress: { street: '1 MG Road', city: 'B', state: 'KA', location: { type: 'Point', coordinates: [77.61, 12.91] } },
    }, { restaurant, skipAvailabilityCheck: true });
    pricedItems = items;
    assert.equal(pricing.subtotal, 198);
    assert.equal(items[0].isCombo, true);
    assert.equal(items[0].comboComponents.length, 2);
});

await check("two combos reserve the parts' stock (4 milk, 2 bread); cancelling gives it back", async () => {
    const order = await FoodOrder.collection.insertOne({ items: pricedItems, stockReservedAt: null, stockRestoredAt: null });
    await reserveStockForItems(pricedItems, { orderId: order.insertedId });
    assert.equal(await stockOf(milk), 6);
    assert.equal(await stockOf(bread), 8);
    await FoodOrder.collection.updateOne({ _id: order.insertedId }, { $set: { stockReservedAt: new Date() } });
    assert.equal(await restoreOrderStock(await FoodOrder.findById(order.insertedId).lean()), true);
    assert.equal(await stockOf(milk), 10);
    assert.equal(await stockOf(bread), 8 + 2);
});

console.log('\n[3] the combo follows its parts');

await check('bread running out takes the combo off sale; a restock brings it back', async () => {
    await FoodItem.updateOne({ _id: bread._id }, { $set: { stockQty: 0 } });
    await syncAvailability(await FoodItem.findById(bread._id).lean());
    assert.equal((await FoodItem.findById(combo._id).lean()).isAvailable, false);
    await FoodItem.updateOne({ _id: bread._id }, { $set: { stockQty: 5 } });
    await syncAvailability(await FoodItem.findById(bread._id).lean(), { revive: true });
    assert.equal((await FoodItem.findById(bread._id).lean()).isAvailable, true);
    assert.equal((await FoodItem.findById(combo._id).lean()).isAvailable, true);
});

await check("food's combos are not quick's", async () => {
    assert.deepEqual(await foodCombos.listCombos(String(restaurantId)), []);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
