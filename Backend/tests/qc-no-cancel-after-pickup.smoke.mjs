/**
 * A quick-commerce order the rider has picked up cannot be cancelled.
 *
 * Run: node tests/qc-no-cancel-after-pickup.smoke.mjs
 *
 * isStatusAdvance allows a cancel from anywhere short of delivered, but a rider
 * is only paid for a delivered order, so a store or support cancelling after
 * pickup left the rider unpaid for the trip. Food was fixed in c9798bd8.
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
await mongoose.connect(mongo.getUri(), { dbName: 'qc_no_cancel_after_pickup' });

try {
    const BASE = '../src/modules/quickCommerce/modules/food';
    const orderService = await import(`${BASE}/orders/services/order.service.js`);
    const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);

    const storeId = new mongoose.Types.ObjectId();
    const rider = new mongoose.Types.ObjectId();
    const order = async (orderStatus) => {
        const _id = new mongoose.Types.ObjectId();
        await FoodOrder.collection.insertOne({
            _id, orderId: `QC-${_id}`, orderStatus,
            userId: new mongoose.Types.ObjectId(),
            restaurantId: storeId,
            deliveryAddress: { label: 'Home', street: '1 Test Rd', city: 'Indore', state: 'MP' },
            items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Milk', price: 30, quantity: 1 }],
            payment: { method: 'cash', status: 'cod_pending' },
            pricing: { subtotal: 30, total: 30 },
            dispatch: { status: 'accepted', deliveryPartnerId: rider, offeredTo: [] },
        });
        return String(_id);
    };
    const statusOf = async (id) => (await FoodOrder.findById(id).lean()).orderStatus;
    const adminId = String(new mongoose.Types.ObjectId());
    const isPickupRefusal = (err) => /picked up/i.test(err?.message || '');

    console.log('\nsupport');
    const a = await order('picked_up');
    const errA = await thrownBy(() => orderService.updateOrderStatusAdmin(a, 'cancelled_by_admin', '', adminId));
    check('THE BUG: cannot cancel a picked-up order', isPickupRefusal(errA), errA?.message || 'cancelled');
    check('it is still picked up', (await statusOf(a)) === 'picked_up');

    console.log('\nthe store');
    const s = await order('reached_drop');
    const errS = await thrownBy(() => orderService.updateOrderStatusRestaurant(s, String(storeId), 'cancelled_by_restaurant'));
    check('cannot cancel an order at the drop', isPickupRefusal(errS), errS?.message || 'cancelled');
    check('it is still at the drop', (await statusOf(s)) === 'reached_drop');

    console.log('\nbefore pickup');
    const p = await order('preparing');
    const errP = await thrownBy(() => orderService.updateOrderStatusAdmin(p, 'cancelled_by_admin', '', adminId));
    check('support can still cancel', !isPickupRefusal(errP), errP?.message);
} catch (err) {
    failed += 1;
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(failed ? 1 : 0);
}
