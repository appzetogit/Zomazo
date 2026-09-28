/**
 * The restaurant panel's Reports download and Analytics data, on both backends,
 * and the quick-commerce commission preview.
 *
 * Run: node tests/seller-order-report.smoke.mjs
 *
 * Reports used to be a page that toasted "Report Queued" and generated nothing;
 * Analytics drew random demo orders when it had none and could only ever see
 * the latest 100. Both now read GET /reports/orders (core/finance/
 * sellerOrderReport.js), mounted on the food and the quick-commerce restaurant
 * routers. What this guards:
 *
 *   - the range is read as whole IST days, and a bad or oversized one is a 400;
 *   - only orders the kitchen could see are reported (not unpaid online
 *     orders, not orders in the cancellation hold, not another seller's);
 *   - payout is the ledger's restaurantShare once captured/authorized, and 0
 *     for an order that has not earned yet -- as the Payouts page counts it;
 *   - the CSV neutralises formula-looking text typed by customers;
 *   - the same builder works on the qc_* collections;
 *   - GET /commission exists on the quick-commerce router and reports the
 *     rate order placement would charge.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '300000';

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};

// Modules first, database second: the two routers pull in a large module
// graph, and on a loaded machine an idle in-memory mongod started before them
// can be gone by the time the first query runs.
const report = await import('../src/core/finance/sellerOrderReport.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { FoodTransaction } = await import('../src/modules/food/orders/models/foodTransaction.model.js');
const qcOrders = await import('../src/modules/quickCommerce/modules/food/orders/models/order.model.js');
const qcTx = await import('../src/modules/quickCommerce/modules/food/orders/models/foodTransaction.model.js');
const foodRouter = (await import('../src/modules/food/restaurant/routes/restaurant.routes.js')).default;
const qcRouter = (await import('../src/modules/quickCommerce/modules/food/restaurant/routes/restaurant.routes.js')).default;
const { FoodRestaurantCommission } = await import(
    '../src/modules/quickCommerce/modules/food/admin/models/restaurantCommission.model.js'
);
const { getRestaurantCommissionRateController } = await import(
    '../src/modules/quickCommerce/modules/food/restaurant/controllers/restaurant.controller.js'
);
console.log('modules loaded');

const server = await MongoMemoryServer.create();
process.env.MONGODB_URI = server.getUri('seller_report');
await mongoose.connect(server.getUri('seller_report'));

const oid = () => new mongoose.Types.ObjectId();
const at = (iso) => new Date(iso);

/** A stored order, written raw: the builder only reads, so validation is not the subject here. */
const order = (restaurantId, overrides = {}) => ({
    _id: oid(),
    order_id: `ORD${Math.floor(Math.random() * 1e9)}`,
    restaurantId,
    userId: oid(),
    customerName: 'Asha',
    items: [{ itemId: String(oid()), name: 'Paneer Tikka', price: 200, quantity: 2 }],
    deliveryAddress: { street: '1 Test Rd', city: 'Palampur', state: 'HP' },
    pricing: { subtotal: 400, packagingFee: 20, discount: 0, tax: 20, total: 470, restaurantCommission: 40 },
    payment: { method: 'cash', status: 'cod_pending' },
    orderStatus: 'delivered',
    restaurantReleaseAt: null,
    createdAt: at('2026-09-10T06:00:00Z'),
    ...overrides,
});
const tx = (o, overrides = {}) => ({
    _id: oid(),
    orderId: o._id,
    restaurantId: o.restaurantId,
    userId: o.userId,
    paymentMethod: 'cash',
    status: 'captured',
    amounts: { totalCustomerPaid: 470, restaurantShare: 380, restaurantCommission: 40, riderShare: 30, platformNetProfit: 20 },
    settlement: { isRestaurantSettled: false },
    ...overrides,
});

const mockRes = () => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    return res;
};
const call = async (controller, restaurantId, query) => {
    const res = mockRes();
    let nextErr = null;
    await controller({ user: { userId: String(restaurantId) }, query }, res, (e) => { nextErr = e; });
    if (nextErr) throw nextErr;
    return res;
};

console.log('\nthe routes');
const hasRoute = (router, method, path) => router.stack.some((l) => l.route?.path === path && l.route.methods?.[method]);
await check('food router serves GET /reports/orders', async () => assert.ok(hasRoute(foodRouter, 'get', '/reports/orders')));
await check('quick-commerce router serves GET /reports/orders', async () => assert.ok(hasRoute(qcRouter, 'get', '/reports/orders')));
await check('quick-commerce router serves GET /commission', async () => assert.ok(hasRoute(qcRouter, 'get', '/commission')));

console.log('\nreading the range');
await check('a bare date is the whole IST day', async () => {
    const { from, to } = report.parseReportRange({ from: '2026-09-10', to: '2026-09-10' });
    assert.equal(from.toISOString(), '2026-09-09T18:30:00.000Z');
    assert.equal(to.toISOString(), '2026-09-10T18:29:59.999Z');
});
await check('from after to is refused', async () => {
    assert.throws(() => report.parseReportRange({ from: '2026-09-10', to: '2026-09-01' }), report.ReportRangeError);
});
await check('more than 366 days is refused', async () => {
    assert.throws(() => report.parseReportRange({ from: '2024-01-01', to: '2026-01-01' }), /at most 366/);
});
await check('garbage is refused', async () => {
    assert.throws(() => report.parseReportRange({ from: 'yesterday-ish' }), /Invalid date/);
});

const runFor = async (label, Order, Transaction) => {
    const mine = oid();
    const other = oid();
    const delivered = order(mine, { customerName: '=HYPERLINK("http://x")' });
    const lateEvening = order(mine, { createdAt: at('2026-09-10T17:00:00Z') }); // 22:30 IST on the 10th
    const cancelled = order(mine, { orderStatus: 'cancelled_by_restaurant', createdAt: at('2026-09-10T08:00:00Z') });
    const preparing = order(mine, { orderStatus: 'preparing', createdAt: at('2026-09-10T09:00:00Z') });
    const unpaidOnline = order(mine, { payment: { method: 'razorpay', status: 'created' } });
    const held = order(mine, { restaurantReleaseAt: at('2026-09-10T06:01:00Z'), restaurantReleasedAt: null });
    const nextDayIst = order(mine, { createdAt: at('2026-09-10T19:00:00Z') }); // 00:30 IST on the 11th
    const foreign = order(other);

    await Order.collection.insertMany([delivered, lateEvening, cancelled, preparing, unpaidOnline, held, nextDayIst, foreign]);
    await Transaction.collection.insertMany([
        tx(delivered),
        tx(lateEvening, { status: 'authorized', settlement: { isRestaurantSettled: true } }),
        tx(preparing, { status: 'pending' }),
        tx(foreign),
    ]);

    const controller = report.makeSellerOrderReportController({ Order, Transaction, label });

    console.log(`\n${label}: JSON`);
    const res = await call(controller, mine, { from: '2026-09-10', to: '2026-09-10' });
    const data = res.body?.data;
    await check('responds 200 with rows', async () => {
        assert.equal(res.statusCode, 200);
        assert.ok(Array.isArray(data?.rows));
    });
    await check('lists exactly the orders the kitchen saw that IST day', async () => {
        const ids = new Set(data.rows.map((r) => r.orderId));
        assert.deepEqual(
            [...ids].sort(),
            [delivered, lateEvening, cancelled, preparing].map((o) => o.order_id).sort(),
        );
    });
    await check('payout is the ledger share once captured or authorized, else 0', async () => {
        const byId = new Map(data.rows.map((r) => [r.orderId, r]));
        assert.equal(byId.get(delivered.order_id).payout, 380);
        assert.equal(byId.get(delivered.order_id).payoutStatus, 'earned');
        assert.equal(byId.get(lateEvening.order_id).payoutStatus, 'settled');
        assert.equal(byId.get(preparing.order_id).payout, 0);
        assert.equal(byId.get(preparing.order_id).payoutStatus, 'not earned');
        assert.equal(byId.get(cancelled.order_id).payout, 0);
    });
    await check('totals: sales are menu + packaging on delivered orders only', async () => {
        assert.equal(data.totals.orders, 4);
        assert.equal(data.totals.deliveredOrders, 2);
        assert.equal(data.totals.cancelledOrders, 1);
        assert.equal(data.totals.sales, 840);
        assert.equal(data.totals.commission, 80);
        assert.equal(data.totals.payout, 760);
    });
    await check('rows carry the IST date the analytics page buckets by', async () => {
        assert.ok(data.rows.every((r) => r.date === '2026-09-10'));
    });

    console.log(`${label}: CSV`);
    const csv = await call(controller, mine, { from: '2026-09-10', to: '2026-09-11', format: 'csv' });
    await check('downloads as an attachment named for the range', async () => {
        assert.match(csv.headers['content-type'], /text\/csv/);
        assert.match(csv.headers['content-disposition'], /attachment; filename=".*2026-09-10-to-2026-09-11\.csv"/);
    });
    await check('has a header and one line per order (next IST day included)', async () => {
        const lines = String(csv.body).replace(/^﻿/, '').split('\r\n');
        assert.match(lines[0], /^Order ID,Placed at \(IST\),Status/);
        const orderLines = lines.slice(1).filter((l) => /^ORD/.test(l));
        assert.equal(orderLines.length, 5);
    });
    await check('formula-looking customer text is neutralised', async () => {
        assert.ok(String(csv.body).includes(`"'=HYPERLINK(""http://x"")"`), 'the name was not escaped');
    });

    console.log(`${label}: refusals`);
    await check('a reversed range is a 400, not a 500', async () => {
        const bad = await call(controller, mine, { from: '2026-09-11', to: '2026-09-10' });
        assert.equal(bad.statusCode, 400);
    });
};

await runFor('food', FoodOrder, FoodTransaction);
await runFor('quick-commerce', qcOrders.FoodOrder, qcTx.FoodTransaction);

console.log('\nquick-commerce commission preview');
await check('reports the seller\'s own rule, as order placement would charge it', async () => {
    const seller = oid();
    await FoodRestaurantCommission.collection.insertOne({
        restaurantId: seller, status: true, defaultCommission: { type: 'percentage', value: 12 },
    });
    let body;
    const res = { status: () => res, json: (b) => { body = b; return res; } };
    await getRestaurantCommissionRateController({ user: { userId: String(seller) } }, res, (e) => { throw e; });
    assert.equal(body?.data?.commissionType, 'percentage');
    assert.equal(body?.data?.commissionValue, 12);
});

await mongoose.disconnect();
await server.stop();
console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);
