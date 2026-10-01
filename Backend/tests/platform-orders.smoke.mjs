/**
 * One common order record (platform_orders) across the platform.
 *
 * Run: node tests/platform-orders.smoke.mjs
 *
 * For each of the five services, through that service's own model: a record
 * created, paid, moved on and cancelled / refunded keeps its platform_orders
 * row in step. A write inside a transaction is synced after the commit, and a
 * rolled-back one writes nothing. The backfill: dry run writes nothing, apply
 * copies, a second run is a no-op. My Orders reads the common record once it
 * is backfilled; Master's All orders filters it and keeps sub-admins to the
 * services they may see.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
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

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = replSet.getUri();
process.env.MONGO_URI = uri;
process.env.MONGODB_URI = uri;
await mongoose.connect(uri, { dbName: 'platform_orders' });
const db = mongoose.connection;

const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodOrder: QuickOrder } = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const { Order: ShopOrder } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const Booking = require('../src/modules/serviceProvider/models/Booking.js');
const { flushPlatformOrderSync } = require('../src/core/orders/platformOrderSync.cjs');
const { PlatformOrder } = await import('../src/core/orders/platformOrder.model.js');
const { listPlatformOrders, clearBackfilledCache } = await import('../src/core/orders/platformOrders.service.js');
const { servicesVisibleTo } = await import('../src/core/orders/platformOrders.routes.js');
const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');
const { backfillPlatformOrders } = await import('../scripts/migrations/backfillPlatformOrders.mjs');

for (const c of ['food_orders', 'qc_orders', 'ecom_orders', 'taxirides', 'sp_bookings', 'platform_orders', 'platform_orders_meta', 'users']) {
    await db.createCollection(c).catch(() => {});
}
await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

const oid = () => new mongoose.Types.ObjectId();
const asha = oid();
const store = oid();
const seller = oid();
const vendor = oid();
await db.collection('users').insertOne({ _id: asha, phone: '9876543210', name: 'Asha', role: 'USER', isActive: true });
await db.collection('food_restaurants').insertOne({ _id: store, restaurantName: 'Spice Hub' });
await db.collection('qc_restaurants').insertOne({ _id: store, restaurantName: 'Fresh Mart', storeType: 'grocery' });
await db.collection('ecom_sellers').insertOne({ _id: seller, sellerName: 'Kurta Co' });
await db.collection('sp_vendors').insertOne({ _id: vendor, businessName: 'FixIt' });

const row = async (service, id) => {
    await flushPlatformOrderSync();
    return PlatformOrder.findOne({ service, sourceId: id }).lean();
};
const saveRaw = (Model, doc) => new Model(doc).save({ validateBeforeSave: false });

const storeOrder = (extra = {}) => ({
    _id: oid(), order_id: `ORD${Math.floor(Math.random() * 1e6)}`, userId: asha, orderStatus: 'pending_payment',
    items: [{ name: 'Paneer', quantity: 2, price: 150 }],
    pricing: { subtotal: 300, tax: 15, deliveryFee: 30, discount: 20, total: 325, couponCode: 'SAVE20' },
    payment: { method: 'razorpay', status: 'pending' }, createdAt: new Date(), ...extra,
});

async function storeLifecycle(service, Model, extra) {
    const doc = storeOrder(extra);
    await saveRaw(Model, doc);
    let r = await row(service, doc._id);
    assert.equal(r?.status, 'placed');
    assert.equal(r.visible, false, 'an unpaid checkout is not shown');
    assert.equal(String(r.platformUserId), String(asha));
    assert.equal(r.amounts.total, 325);
    assert.equal(r.couponCode, 'SAVE20');
    await Model.findOneAndUpdate({ _id: doc._id }, { $set: { orderStatus: 'created', 'payment.status': 'paid', 'payment.razorpay': { paymentId: 'pay_1' } } });
    r = await row(service, doc._id);
    assert.equal(r.visible, true);
    assert.equal(r.payment.status, 'paid');
    assert.equal(r.payment.gatewayRef, 'pay_1');
    assert.equal(r.amounts.paid, 325);
    await Model.updateOne({ _id: doc._id }, { $set: { orderStatus: 'picked_up' } });
    assert.equal((await row(service, doc._id)).status, 'out_for_delivery');
    await Model.updateMany({ _id: doc._id }, { $set: { orderStatus: 'cancelled_by_restaurant', 'payment.status': 'refunded', 'payment.refund': { status: 'processed', amount: 325 } } });
    r = await row(service, doc._id);
    assert.equal(r.status, 'refunded');
    assert.equal(r.rawStatus, 'cancelled_by_restaurant');
    assert.equal(r.amounts.refunded, 325);
    assert.ok(r.cancelledAt);
    return doc;
}

console.log('\nHooks keep the row in step');
await check('Food: create -> pay -> on the way -> cancelled and refunded', async () => {
    const d = await storeLifecycle('food', FoodOrder, { restaurantId: store });
    assert.equal((await row('food', d._id)).partner.name, 'Spice Hub');
});
await check('Quick: the same', async () => {
    const d = await storeLifecycle('quickCommerce', QuickOrder, { restaurantId: store });
    assert.equal((await row('quickCommerce', d._id)).route, `/quick/orders/${d._id}`);
});
await check('Shop: the same', async () => {
    const d = await storeLifecycle('ecommerce', ShopOrder, { sellerId: seller });
    assert.equal((await row('ecommerce', d._id)).partner.name, 'Kurta Co');
});
await check('Rides: requested -> accepted -> on trip -> completed; another cancelled', async () => {
    const ride = { _id: oid(), userId: asha, status: 'searching', fare: 240, paymentMethod: 'cash', pickupAddress: 'Home, Pune', dropAddress: 'Airport, Pune', promo: { code: 'RIDE10', discount_amount: 10 }, createdAt: new Date() };
    await saveRaw(Ride, ride);
    assert.equal((await row('taxi', ride._id)).status, 'placed');
    await Ride.updateOne({ _id: ride._id }, { $set: { status: 'accepted' } });
    assert.equal((await row('taxi', ride._id)).status, 'confirmed');
    await Ride.findOneAndUpdate({ _id: ride._id }, { $set: { status: 'ongoing' } });
    assert.equal((await row('taxi', ride._id)).status, 'on_trip');
    await Ride.updateOne({ _id: ride._id }, { $set: { status: 'completed', completedAt: new Date() } });
    const r = await row('taxi', ride._id);
    assert.equal(r.status, 'completed');
    assert.equal(r.amounts.total, 240);
    assert.equal(r.amounts.paid, 240);
    assert.equal(r.couponCode, 'RIDE10');
    assert.equal(r.title, 'Ride to Airport');
    const other = { _id: oid(), userId: asha, status: 'searching', fare: 100, createdAt: new Date() };
    await saveRaw(Ride, other);
    await Ride.updateOne({ _id: other._id }, { $set: { status: 'cancelled' } });
    assert.equal((await row('taxi', other._id)).status, 'cancelled');
});
await check('Services: booked -> paid -> in progress -> cancelled and refunded', async () => {
    const b = { _id: oid(), bookingNumber: 'SPB100', userId: asha, vendorId: vendor, status: 'searching', serviceName: 'AC repair', basePrice: 500, tax: 90, finalAmount: 590, paymentStatus: 'pending', paymentMethod: 'online', createdAt: new Date() };
    await saveRaw(Booking, b);
    assert.equal((await row('serviceProvider', b._id)).status, 'placed');
    await Booking.findOneAndUpdate({ _id: b._id }, { $set: { paymentStatus: 'success', paidAmount: 590, status: 'confirmed' } });
    let r = await row('serviceProvider', b._id);
    assert.equal(r.status, 'confirmed');
    assert.equal(r.amounts.paid, 590);
    await Booking.updateOne({ _id: b._id }, { $set: { status: 'in_progress' } });
    assert.equal((await row('serviceProvider', b._id)).status, 'in_progress');
    await Booking.updateOne({ _id: b._id }, { $set: { status: 'cancelled', paymentStatus: 'refunded', refundedAmount: 590, cancelledAt: new Date() } });
    r = await row('serviceProvider', b._id);
    assert.equal(r.status, 'refunded');
    assert.equal(r.amounts.refunded, 590);
    assert.equal(r.partner.name, 'FixIt');
});
await check('a deleted record takes its row with it', async () => {
    const doc = storeOrder({ restaurantId: store });
    await saveRaw(FoodOrder, doc);
    assert.ok(await row('food', doc._id));
    await FoodOrder.deleteOne({ _id: doc._id });
    assert.equal(await row('food', doc._id), null);
});

console.log('\nTransactions');
await check('a rolled-back create writes nothing; a committed update lands after the commit', async () => {
    const doc = storeOrder({ restaurantId: store });
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        await new FoodOrder(doc).save({ session, validateBeforeSave: false });
        await session.abortTransaction();
    } finally {
        session.endSession();
    }
    assert.equal(await row('food', doc._id), null);

    const kept = storeOrder({ restaurantId: store, orderStatus: 'created', payment: { method: 'cash', status: 'cod_pending' } });
    await saveRaw(FoodOrder, kept);
    const s2 = await mongoose.startSession();
    try {
        await s2.withTransaction(async () => {
            await FoodOrder.updateOne({ _id: kept._id }, { $set: { orderStatus: 'confirmed' } }, { session: s2 });
        });
    } finally {
        s2.endSession();
    }
    assert.equal((await row('food', kept._id)).status, 'confirmed');

    const s3 = await mongoose.startSession();
    try {
        s3.startTransaction();
        await FoodOrder.updateOne({ _id: kept._id }, { $set: { orderStatus: 'delivered' } }, { session: s3 });
        await s3.abortTransaction();
    } finally {
        s3.endSession();
    }
    assert.equal((await row('food', kept._id)).status, 'confirmed', 'a rolled-back update leaves the row as committed');
});

console.log('\nBackfill');
await check('records written around the hooks are picked up: dry run nothing, apply, re-run no-op', async () => {
    const raw = storeOrder({ restaurantId: store, orderStatus: 'delivered', payment: { method: 'cash', status: 'paid' } });
    await db.collection('qc_orders').insertOne(raw);
    await db.collection('sp_bookings').insertOne({ _id: oid(), userId: asha, status: 'completed', finalAmount: 50, createdAt: new Date(Date.now() - 86400000) });
    const before = await PlatformOrder.countDocuments();
    const dry = await backfillPlatformOrders({ log: () => {} });
    assert.ok(dry.quickCommerce.toWrite >= 1);
    assert.equal(await PlatformOrder.countDocuments(), before);
    const applied = await backfillPlatformOrders({ apply: true, batch: 2, log: () => {} });
    assert.ok(applied.quickCommerce.written >= 1);
    assert.equal((await PlatformOrder.findOne({ service: 'quickCommerce', sourceId: raw._id }).lean()).status, 'delivered');
    const snap = JSON.stringify(await PlatformOrder.find({}).sort({ _id: 1 }).lean());
    const again = await backfillPlatformOrders({ apply: true, log: () => {} });
    assert.ok(Object.values(again).every((x) => x.written === 0));
    assert.equal(JSON.stringify(await PlatformOrder.find({}).sort({ _id: 1 }).lean()), snap);
});

console.log('\nReading it');
await check('My Orders reads the common record once backfilled, in its own shape', async () => {
    clearBackfilledCache();
    const all = await listMyOrders(String(asha), { limit: 50 });
    const services = new Set(all.items.map((i) => i.service));
    for (const s of ['food', 'quick', 'shop', 'taxi', 'services']) assert.ok(services.has(s), `${s} missing: ${JSON.stringify([...services])}`);
    assert.ok(all.items.every((i) => i.route && i.key && i.statusLabel));
    assert.ok(!all.items.some((i) => i.statusLabel === 'Pending payment'), 'unpaid checkouts stay hidden');
    const rides = await listMyOrders(String(asha), { service: 'rides' });
    assert.ok(rides.items.length >= 2 && rides.items.every((i) => i.service === 'taxi'));
    const past = await listMyOrders(String(asha), { state: 'past' });
    assert.ok(past.items.every((i) => i.state !== 'ongoing'));
});
await check('Master All orders filters by service, status, phone and partner', async () => {
    const all = await listPlatformOrders({ limit: 100 });
    assert.ok(all.items.length >= 6);
    assert.ok((await listPlatformOrders({ service: 'taxi' })).items.every((r) => r.service === 'taxi'));
    assert.ok((await listPlatformOrders({ status: 'refunded' })).items.every((r) => r.status === 'refunded'));
    assert.ok((await listPlatformOrders({ phone: '9876543210' })).items.length >= 6);
    assert.equal((await listPlatformOrders({ phone: '9000000000' })).items.length, 0);
    assert.ok((await listPlatformOrders({ partner: 'kurta' })).items.every((r) => r.service === 'ecommerce'));
});
await check('a sub-admin sees only the services whose orders they may read', () => {
    const owner = { role: 'ADMIN', admin_type: 'superadmin', isActive: true };
    assert.equal(servicesVisibleTo(owner).length, 5);
    const shopOnly = { role: 'ADMIN', admin_type: 'subadmin', adminLevel: 'subadmin', module: 'ecommerce', servicesAccess: ['ecommerce'], permissions: ['orders.read'], isActive: true };
    assert.deepEqual(servicesVisibleTo(shopOnly), ['ecommerce']);
    const noOrders = { ...shopOnly, permissions: ['customers.read'] };
    assert.deepEqual(servicesVisibleTo(noOrders), []);
});

await check('a normal order update makes no extra find on the order collection', async () => {
    const doc = storeOrder();
    await saveRaw(FoodOrder, doc);
    await flushPlatformOrderSync();
    let reads = 0;
    mongoose.set('debug', (collection, method) => {
        // find(): what the hook used to run for ids. (The sync itself reads the
        // record back with findOne by _id, in the background -- that is the sync.)
        if (collection === 'food_orders' && method === 'find') reads += 1;
    });
    try {
        await FoodOrder.updateOne({ _id: doc._id }, { $set: { orderStatus: 'created' } });
        await FoodOrder.findOneAndUpdate({ _id: doc._id }, { $set: { 'payment.status': 'paid' } });
        await FoodOrder.updateMany({ _id: { $in: [doc._id] } }, { $set: { orderStatus: 'picked_up' } });
        await flushPlatformOrderSync();
        assert.equal(reads, 0, `${reads} extra find(s) for writes that name their record`);
        assert.equal((await row('food', doc._id)).status, 'out_for_delivery');

        // A filter that does not name the id: read once, after the write, widened past
        // the field the update changes (the record no longer matches the original filter).
        reads = 0;
        const pending = FoodOrder.updateOne({ order_id: doc.order_id, orderStatus: 'picked_up' }, { $set: { orderStatus: 'delivered' } });
        await pending;
        assert.equal(reads, 0, 'the id lookup ran before the write returned');
        await flushPlatformOrderSync();
        assert.equal(reads, 1);
        assert.equal((await row('food', doc._id)).status, 'delivered');
    } finally {
        mongoose.set('debug', false);
    }
});

await mongoose.disconnect();
await replSet.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
