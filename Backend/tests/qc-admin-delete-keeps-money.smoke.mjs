/**
 * Support cannot delete a quick-commerce order that money has moved on.
 *
 * Run: node tests/qc-admin-delete-keeps-money.smoke.mjs
 *
 * Deleting removes the order and its ledger row, so deleting a delivered or
 * paid order erased the rider's cash debt and earning and the store's share.
 * An unpaid, undelivered order can still be removed. Food: c9798bd8.
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
await mongoose.connect(mongo.getUri(), { dbName: 'qc_admin_delete' });

try {
    const BASE = '../src/modules/quickCommerce/modules/food';
    const orderService = await import(`${BASE}/orders/services/order.service.js`);
    const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);

    const order = async (orderStatus, payment) => {
        const _id = new mongoose.Types.ObjectId();
        await FoodOrder.collection.insertOne({
            _id, orderId: `QC-${_id}`, orderStatus, payment,
            userId: new mongoose.Types.ObjectId(),
            restaurantId: new mongoose.Types.ObjectId(),
            items: [],
        });
        return String(_id);
    };
    const exists = async (id) => Boolean(await FoodOrder.findById(id).lean());
    const adminId = String(new mongoose.Types.ObjectId());

    const delivered = await order('delivered', { method: 'cash', status: 'paid' });
    const e1 = await thrownBy(() => orderService.deleteOrderAdmin(delivered, adminId));
    check('THE BUG: a delivered COD order cannot be deleted', Boolean(e1) && (await exists(delivered)), e1?.message || 'deleted');

    const paid = await order('confirmed', { method: 'razorpay', status: 'paid' });
    const e2 = await thrownBy(() => orderService.deleteOrderAdmin(paid, adminId));
    check('a paid order cannot be deleted', Boolean(e2) && (await exists(paid)), e2?.message || 'deleted');

    const abandoned = await order('cancelled_by_user', { method: 'razorpay', status: 'failed' });
    const e3 = await thrownBy(() => orderService.deleteOrderAdmin(abandoned, adminId));
    check('an unpaid, undelivered order can be', !e3 && !(await exists(abandoned)), e3?.message);
} catch (err) {
    failed += 1;
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(failed ? 1 : 0);
}
