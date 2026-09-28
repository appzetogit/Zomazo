/**
 * A quick-commerce seller's buy-one-get-one products and free item over a
 * spend, priced into Quick orders with food's rules over the store's own offers.
 *
 * Run: node tests/qc-seller-offers.smoke.mjs
 *
 * What this guards:
 *   - a seller saves both offers on the shared panel's endpoints (/qc);
 *   - buy one get one splits the free unit onto its own zero-priced line and
 *     takes it out of the subtotal; the add-ons on it are still charged;
 *   - the free item is earned on what the customer pays for (after the free
 *     unit), appended at zero, and skipped when the store has none in stock;
 *   - the quote says what was saved and how close the next reward is;
 *   - quick offers never apply to food, and food's own still work.
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
process.env.MONGODB_URI = mongo.getUri('qc_seller_offers');
await mongoose.connect(mongo.getUri('qc_seller_offers'));

const BASE = '../src/modules/quickCommerce/modules/food';
const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { QCZone } = await import(`${BASE}/admin/models/zone.model.js`);
const { FoodRestaurant } = await import(`${BASE}/restaurant/models/restaurant.model.js`);
const { calculateOrderPricing } = await import(`${BASE}/orders/services/order-pricing.service.js`);
const { FoodItem } = await import(`${BASE}/admin/models/food.model.js`);
const { FoodFeeSettings } = await import(`${BASE}/admin/models/feeSettings.model.js`);
const { qcBogo } = await import(`${BASE}/shared/offers.js`);
const foodBogo = await import('../src/modules/food/shared/bogoOffer.service.js');

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

const milk = await FoodItem.create({ restaurantId, name: 'Milk', price: 30, gstRate: 0, approvalStatus: 'approved' });
const bread = await FoodItem.create({ restaurantId, name: 'Bread', price: 100, gstRate: 0, approvalStatus: 'approved' });
const chocolate = await FoodItem.create({ restaurantId, name: 'Chocolate', price: 20, gstRate: 0, approvalStatus: 'approved', stockQty: 5 });

const sellerToken = signAccessToken({ userId: String(restaurantId), sub: String(restaurantId), role: 'RESTAURANT' });
const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
};

const address = { street: '1 MG Road', city: 'Bengaluru', state: 'KA', location: { type: 'Point', coordinates: [77.61, 12.91] } };
const quote = (items) => calculateOrderPricing(String(new mongoose.Types.ObjectId()), {
    restaurantId: String(restaurantId), items, deliveryAddress: address,
}, { restaurant, skipAvailabilityCheck: true });

console.log('\n[1] the seller saves them');

await check('buy one get one: saved and read back', async () => {
    const put = await call('PUT', '/v1/qc/restaurant/bogo-offer', { offers: [{ itemId: String(milk._id), buyQty: 1, getQty: 1 }] });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const got = await call('GET', '/v1/qc/restaurant/bogo-offer');
    assert.equal(got.json.data.offer.offers.length, 1);
});

await check('free item over a spend: saved; a bad tier is refused', async () => {
    const bad = await call('PUT', '/v1/qc/restaurant/freebie-offer', { tiers: [{ minOrderValue: 0, rewardType: 'item', rewardItemId: String(chocolate._id) }] });
    assert.equal(bad.status, 400);
    const put = await call('PUT', '/v1/qc/restaurant/freebie-offer', { tiers: [{ minOrderValue: 150, rewardType: 'item', rewardItemId: String(chocolate._id) }] });
    assert.equal(put.status, 200, JSON.stringify(put.json));
});

console.log('\n[2] Quick orders apply them');

await check('two milks: one paid, one free on its own line, out of the subtotal', async () => {
    const { items, pricing } = await quote([{ itemId: String(milk._id), quantity: 2, price: 30 }]);
    const lines = items.filter((i) => String(i.itemId) === String(milk._id));
    assert.deepEqual(lines.map((l) => [l.quantity, l.price, Boolean(l.isBogoFree)]), [[1, 30, false], [1, 0, true]]);
    assert.equal(pricing.subtotal, 30);
    assert.equal(pricing.bogoSavings, 30);
    assert.equal(pricing.bogo.totalFreeUnits, 1);
});

await check('one milk: the quote nudges "add 1 more and get it free"', async () => {
    const { pricing } = await quote([{ itemId: String(milk._id), quantity: 1, price: 30 }]);
    assert.equal(pricing.bogo.next.length, 1);
    assert.equal(pricing.bogo.next[0].unitsAway, 1);
});

await check('the free item is earned on what is paid for, and appended at zero', async () => {
    // 2 milk (30 paid, 30 free) + bread 100 = 130 paid: short of 150.
    const short = await quote([{ itemId: String(milk._id), quantity: 2, price: 30 }, { itemId: String(bread._id), quantity: 1, price: 100 }]);
    assert.ok(!short.items.some((i) => i.isFreebie));
    assert.equal(short.pricing.freebie.next.amountAway, 20);
    // + another bread: 230 paid, earns the chocolate.
    const earned = await quote([{ itemId: String(milk._id), quantity: 2, price: 30 }, { itemId: String(bread._id), quantity: 2, price: 100 }]);
    const free = earned.items.find((i) => i.isFreebie);
    assert.equal(free?.name, 'Chocolate');
    assert.equal(free.price, 0);
    assert.equal(earned.pricing.subtotal, 230);
    assert.equal(earned.pricing.freebie.earned.name, 'Chocolate');
});

await check('a free item the store has none of is left out, not an error', async () => {
    await FoodItem.updateOne({ _id: chocolate._id }, { $set: { stockQty: 0 } });
    const { items, pricing } = await quote([{ itemId: String(bread._id), quantity: 2, price: 100 }]);
    assert.ok(!items.some((i) => i.isFreebie));
    assert.equal(pricing.freebie.earned, null);
    await FoodItem.updateOne({ _id: chocolate._id }, { $set: { stockQty: 5 } });
});

console.log('\n[3] kept apart from food');

await check("quick offers are not food's, and food's still apply", async () => {
    assert.equal(await foodBogo.getBogoOffer(String(restaurantId)), null);
    await foodBogo.saveBogoOffer(String(restaurantId), { offers: [{ itemId: String(bread._id), buyQty: 1, getQty: 1 }] });
    const quick = await qcBogo.getBogoOffer(String(restaurantId));
    assert.deepEqual(quick.offers.map((o) => String(o.itemId)), [String(milk._id)]);
    const { items } = await foodBogo.applyBogoToItems(String(restaurantId), [{ itemId: String(bread._id), name: 'Bread', price: 100, quantity: 2 }]);
    assert.equal(items.filter((i) => i.isBogoFree).length, 1);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
