/**
 * One rider app, both delivery pools.
 *
 * Run: node tests/qc-rider-bridge.smoke.mjs
 *
 * Quick commerce dispatches to its own pool, qc_delivery_partners, and only a
 * token minted for a row in that pool got through /qc/delivery. The web rider
 * app signs riders in against FOOD, so no rider it signed in could ever be
 * offered, accept or deliver a grocery or medicine order.
 *
 * core/identity/qcRiderBridge.js lets the food rider's token through, links
 * (or creates) their grocery row, and keeps it online/offline and placed where
 * the food record says. This drives it over HTTP through the real platform and
 * quick-commerce routers, and QC's real dispatcher, against an in-memory Mongo:
 *
 *   - a food rider token reaches /qc/delivery and is linked to ONE grocery row;
 *   - going online in the rider app makes them a candidate for QC dispatch;
 *   - they accept, pick up, hand over with the customer's code and complete;
 *   - a rider on a food job is busy for groceries, and the reverse;
 *   - the grocery earning lands in the rider's one balance;
 *   - a rider rejected on the food side is refused here too.
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV ||= 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_rider_bridge' });

let failed = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`  PASS  ${label}`); }
    catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

const { signAccessToken } = await import('../src/core/auth/token.util.js');
const platformRoutes = (await import('../src/routes/index.js')).default;
const qcRouter = (await import('../src/modules/quickCommerce/routes/index.js')).default;
const { FoodDeliveryPartner: FoodPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: FoodOrderModel } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodDeliveryPartner: QCPartner } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder: QCOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { FoodRestaurant: QCStore } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodUser: QCUser } = await import('../src/modules/quickCommerce/core/users/user.model.js');
const qcDispatch = await import('../src/modules/quickCommerce/modules/food/orders/services/order-dispatch.service.js');
const { getBusyDeliveryPartnerIds } = await import('../src/modules/quickCommerce/modules/food/orders/services/order.helpers.js');
const bridge = await import('../src/core/identity/qcRiderBridge.js');
const { getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');

const app = express();
app.use(express.json());
app.use('/api', platformRoutes);
app.use('/api/v1/qc', qcRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

const call = (token, method, path, body) => fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));

// Indore; the store sits ~1 km from where the rider goes online.
const STORE = { lat: 22.7196, lng: 75.8577 };
const RIDER = { latitude: 22.7270, longitude: 75.8640 };

const food = await FoodPartner.create({ name: 'Ravi Rider', phone: '+91 98123 45678', status: 'approved', vehicleNumber: 'MP09AB1234' });
const foodId = String(food._id);
const token = signAccessToken({ userId: foodId, role: 'DELIVERY_PARTNER' });

let qcId = null;
let orderId = null;

console.log('\na food rider token reaching quick commerce');

await check('is accepted by /qc/delivery (it was refused before)', async () => {
    const res = await call(token, 'GET', '/qc/delivery/orders/available');
    assert.equal(res.status, 200, `${res.status} ${res.body.message}`);
});

await check('and is linked to exactly one grocery-pool row, mirroring approval', async () => {
    const rows = await QCPartner.find({ platformDeliveryPartnerId: food._id }).lean();
    assert.equal(rows.length, 1, `${rows.length} rows`);
    qcId = String(rows[0]._id);
    assert.equal(rows[0].status, 'approved');
    assert.equal(rows[0].phone, '9812345678', 'phone stored as ten digits');
    assert.equal(rows[0].availabilityStatus, 'offline', 'offline until the rider goes online');
});

await check('a second request reuses the same row', async () => {
    await call(token, 'GET', '/qc/delivery/orders/current');
    assert.equal(await QCPartner.countDocuments({ platformDeliveryPartnerId: food._id }), 1);
});

await check('an existing grocery account on the same phone is adopted, not duplicated', async () => {
    const other = await FoodPartner.create({ name: 'Old QC', phone: '9000011111', status: 'approved' });
    const legacy = await QCPartner.create({ name: 'Old QC', phone: '9000011111', status: 'approved' });
    const t = signAccessToken({ userId: String(other._id), role: 'DELIVERY_PARTNER' });
    const res = await call(t, 'GET', '/qc/delivery/orders/current');
    assert.equal(res.status, 200, `${res.status} ${res.body.message}`);
    const rows = await QCPartner.find({ phone: /9000011111$/ }).lean();
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0]._id), String(legacy._id));
    assert.equal(String(rows[0].platformDeliveryPartnerId), String(other._id));
});

await check('a token for no rider at all is still refused', async () => {
    const ghost = signAccessToken({ userId: String(new mongoose.Types.ObjectId()), role: 'DELIVERY_PARTNER' });
    const res = await call(ghost, 'GET', '/qc/delivery/orders/available');
    assert.equal(res.status, 401);
});

console.log('\ngoing online in the rider app');

await check('the food availability call succeeds as before', async () => {
    const res = await call(token, 'PATCH', '/food/delivery/availability', { status: 'online', ...RIDER });
    assert.equal(res.status, 200, `${res.status} ${res.body.message}`);
    assert.equal(res.body.data?.availabilityStatus, 'online');
});

await check('puts the grocery row online at the same position', async () => {
    const row = await QCPartner.findById(qcId).lean();
    assert.equal(row.availabilityStatus, 'online');
    assert.equal(row.lastLat, RIDER.latitude);
    assert.equal(row.lastLng, RIDER.longitude);
    assert.ok(row.lastLocationAt && Date.now() - new Date(row.lastLocationAt).getTime() < 60_000, 'fresh GPS');
});

const buyer = (await QCUser.collection.insertOne({ name: 'Asha', phone: '9777700000', isActive: true })).insertedId;
const store = (await QCStore.collection.insertOne({
    restaurantName: 'Fresh Mart', ownerName: 'Owner', status: 'approved', pureVegRestaurant: false,
    location: { type: 'Point', coordinates: [STORE.lng, STORE.lat] },
})).insertedId;
const newQcOrder = async (extra = {}) => QCOrder.create({
    userId: buyer,
    restaurantId: store,
    items: [{ itemId: 'milk-1', name: 'Milk 1L', price: 60, quantity: 2 }],
    deliveryAddress: { street: '12 MG Road', city: 'Indore', state: 'MP', location: { type: 'Point', coordinates: [75.87, 22.73] } },
    pricing: { subtotal: 120, deliveryFee: 25, total: 145 },
    payment: { method: 'razorpay', status: 'paid' },
    orderStatus: 'confirmed',
    dispatch: { status: 'unassigned', offeredTo: [] },
    riderEarning: 45,
    ...extra,
});

await check('QC dispatch now offers them a grocery order', async () => {
    const order = await newQcOrder();
    orderId = String(order._id);
    await qcDispatch.tryAutoAssign(orderId);
    const after = await QCOrder.findById(orderId).lean();
    const offered = (after.dispatch.offeredTo || []).map((o) => String(o.partnerId));
    assert.ok(offered.includes(qcId), `offered to [${offered.join(', ')}]`);
});

await check('and it shows in their available list', async () => {
    const res = await call(token, 'GET', '/qc/delivery/orders/available');
    const ids = (res.body.data?.data || []).map((o) => String(o._id));
    assert.ok(ids.includes(orderId), `listed: [${ids.join(', ')}]`);
});

console.log('\nno double dispatch');

await check('a rider carrying a FOOD order is busy for groceries', async () => {
    const { insertedId } = await FoodOrderModel.collection.insertOne({
        orderStatus: 'picked_up', dispatch: { status: 'accepted', deliveryPartnerId: food._id }, createdAt: new Date(),
    });
    try {
        assert.ok((await getBusyDeliveryPartnerIds()).has(qcId), 'QC dispatch still sees them free');
        const res = await call(token, 'PATCH', `/qc/delivery/orders/${orderId}/accept`);
        assert.equal(res.status, 400, `accept went through: ${res.status}`);
        assert.match(String(res.body.message), /active delivery/i);
    } finally {
        await FoodOrderModel.collection.deleteOne({ _id: insertedId });
    }
});

console.log('\ndelivering the grocery order');

await check('accept', async () => {
    const res = await call(token, 'PATCH', `/qc/delivery/orders/${orderId}/accept`);
    assert.equal(res.status, 200, `${res.status} ${res.body.message}`);
    const o = await QCOrder.findById(orderId).lean();
    assert.equal(o.dispatch.status, 'accepted');
    assert.equal(String(o.dispatch.deliveryPartnerId), qcId, 'assigned to the grocery row, not the food id');
});

await check('it is their current trip', async () => {
    const res = await call(token, 'GET', '/qc/delivery/orders/current');
    assert.equal(String(res.body.data?.activeOrder?._id), orderId);
});

await check('while it is on, food treats them as busy', async () => {
    assert.equal(await bridge.foodRiderOnQcJob(foodId), true);
    assert.ok((await bridge.foodPartnerIdsBusyOnQc()).has(foodId));
});

await check('reached pickup, picked up, reached drop', async () => {
    for (const step of ['reached-pickup', 'confirm-pickup', 'reached-drop']) {
        const res = await call(token, 'PATCH', `/qc/delivery/orders/${orderId}/${step}`, {});
        assert.equal(res.status, 200, `${step}: ${res.status} ${res.body.message}`);
    }
    const o = await QCOrder.findById(orderId).lean();
    assert.equal(o.orderStatus, 'picked_up');
    assert.equal(o.deliveryState?.currentPhase, 'at_drop');
});

await check('a wrong handover code is refused', async () => {
    const res = await call(token, 'POST', `/qc/delivery/orders/${orderId}/verify-drop-otp`, { otp: '0000' });
    assert.equal(res.status, 400);
});

await check("the customer's code, then complete", async () => {
    const { deliveryOtp } = await QCOrder.findById(orderId).select('+deliveryOtp').lean();
    const verify = await call(token, 'POST', `/qc/delivery/orders/${orderId}/verify-drop-otp`, { otp: deliveryOtp });
    assert.equal(verify.status, 200, `${verify.status} ${verify.body.message}`);
    const done = await call(token, 'PATCH', `/qc/delivery/orders/${orderId}/complete`, { otp: deliveryOtp });
    assert.equal(done.status, 200, `${done.status} ${done.body.message}`);
    assert.equal((await QCOrder.findById(orderId).lean()).orderStatus, 'delivered');
});

await check('the rider is free again for food', async () => {
    assert.equal(await bridge.foodRiderOnQcJob(foodId), false);
});

await check('the trip is in their grocery trip history', async () => {
    const res = await call(token, 'GET', '/qc/delivery/trip-history?period=daily');
    assert.equal(res.status, 200, `${res.status} ${res.body.message}`);
    const trips = res.body.data?.trips || [];
    const trip = trips.find((t) => String(t._id) === orderId);
    assert.ok(trip, `not listed: ${JSON.stringify(trips.map((t) => t._id))}`);
    assert.equal(trip.status, 'Completed');
    assert.equal(trip.deliveryEarning, 45);
});

await check("and the Rs 45 earning is in the rider's one balance (read by food id)", async () => {
    const f = await getRiderFinance(foodId);
    assert.equal(String(f.qcPartnerId), qcId);
    assert.equal(f.breakdown.delivery.byVertical.quickCommerce.totalEarned, 45);
});

console.log('\ngoing offline, and a rejected rider');

await check('going offline takes the grocery row offline', async () => {
    const res = await call(token, 'PATCH', '/food/delivery/availability', { status: 'offline' });
    assert.equal(res.status, 200);
    assert.equal((await QCPartner.findById(qcId).lean()).availabilityStatus, 'offline');
});

await check('a rider rejected on the food side is refused by quick commerce', async () => {
    await FoodPartner.updateOne({ _id: food._id }, { $set: { status: 'rejected' } });
    const res = await call(token, 'GET', '/qc/delivery/orders/available');
    assert.equal(res.status, 403, `status ${res.status}`);
    assert.equal((await QCPartner.findById(qcId).lean()).status, 'rejected');
});

await check('a QC-side deactivation is not undone by food re-approving', async () => {
    await QCPartner.updateOne({ _id: qcId }, { $set: { status: 'deactivated' } });
    await FoodPartner.updateOne({ _id: food._id }, { $set: { status: 'approved' } });
    const res = await call(token, 'GET', '/qc/delivery/orders/available');
    assert.equal(res.status, 403, `status ${res.status}`);
    assert.equal((await QCPartner.findById(qcId).lean()).status, 'deactivated');
});

await check('QC_RIDER_BRIDGE=off stops enrolling new food riders', async () => {
    process.env.QC_RIDER_BRIDGE = 'off';
    try {
        const fresh = await FoodPartner.create({ name: 'New', phone: '9555500000', status: 'approved' });
        const t = signAccessToken({ userId: String(fresh._id), role: 'DELIVERY_PARTNER' });
        const res = await call(t, 'GET', '/qc/delivery/orders/available');
        assert.equal(res.status, 401);
        assert.equal(await QCPartner.countDocuments({ platformDeliveryPartnerId: fresh._id }), 0);
    } finally {
        delete process.env.QC_RIDER_BRIDGE;
    }
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
