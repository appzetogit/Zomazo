/**
 * Support cannot confirm a quick-commerce order still waiting for its online payment.
 *
 * Run: node tests/qc-unpaid-order-not-confirmed.smoke.mjs
 *
 * pending_payment is absent from STATUS_PRIORITY, so the admin status update
 * let an unpaid order be confirmed -- which also started dispatch for it.
 * Cancelling stays available. Food was fixed in 3204e69c.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
};
const thrownBy = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_unpaid_not_confirmed' });

try {
    const BASE = '../src/modules/quickCommerce/modules/food';
    const orderService = await import(`${BASE}/orders/services/order.service.js`);
    const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);

    const _id = new mongoose.Types.ObjectId();
    await FoodOrder.collection.insertOne({
        _id, orderId: `QC-${_id}`, orderStatus: 'pending_payment',
        userId: new mongoose.Types.ObjectId(),
        restaurantId: new mongoose.Types.ObjectId(),
        deliveryAddress: { label: 'Home', street: '1 Test Rd', city: 'Indore', state: 'MP' },
        items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Milk', price: 30, quantity: 1 }],
        payment: { method: 'razorpay', status: 'created' },
        dispatch: { status: 'unassigned', offeredTo: [] },
    });
    const adminId = String(new mongoose.Types.ObjectId());

    const err = await thrownBy(() => orderService.updateOrderStatusAdmin(String(_id), 'confirmed', '', adminId));
    console.log(`  (answer: ${err?.message || 'no error'})`);
    const after = await FoodOrder.findById(_id).lean();
    check('THE BUG: support cannot confirm it', /waiting for the customer.s payment/i.test(err?.message || ''), err?.message || 'confirmed');
    check('it is still awaiting payment', after.orderStatus === 'pending_payment', after.orderStatus);
} catch (err) {
    failed += 1;
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(failed ? 1 : 0);
}
