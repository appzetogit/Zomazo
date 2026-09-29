/**
 * A quick-commerce rider's cash limit is the one riderFinance resolves.
 *
 * Run: node tests/qc-rider-cash-limit.smoke.mjs
 *
 * Accept and dispatch read the QC wallet alone against the old global QC
 * setting: cash from other verticals was invisible, a per-rider limit set in
 * Platform settings never applied, and the order's own cash did not count.
 * Food was moved to riderFinance in be22eede; this pins the QC fork.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
};
const thrownBy = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
await mongoose.connect(replSet.getUri(), { dbName: 'qc_rider_cash_limit' });

try {
    const BASE = '../src/modules/quickCommerce/modules/food';
    const config = await import('../src/core/config/resolver.service.js');
    const delivery = await import(`${BASE}/orders/services/order-delivery.service.js`);
    const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);
    const { FoodDeliveryPartner } = await import(`${BASE}/delivery/models/deliveryPartner.model.js`);

    const rider = new mongoose.Types.ObjectId();
    await FoodDeliveryPartner.collection.insertOne({
        _id: rider, name: 'Ravi', phone: '9000000002', status: 'approved', availabilityStatus: 'online',
    });
    const setRiderLimit = async (value) => {
        await config.set('finance.cashLimit', { level: 'partner', scopeId: String(rider), value, updatedBy: 'test', reason: 'test' });
        config.invalidateCache();
    };
    const cashOrder = async (total) => {
        const _id = new mongoose.Types.ObjectId();
        await FoodOrder.collection.insertOne({
            _id, orderId: `QC-${_id}`, orderStatus: 'preparing',
            userId: new mongoose.Types.ObjectId(),
            restaurantId: new mongoose.Types.ObjectId(),
            deliveryAddress: { label: 'Home', street: '1 Test Rd', city: 'Indore', state: 'MP' },
            items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Milk', price: total, quantity: 1 }],
            payment: { method: 'cash', status: 'cod_pending' },
            pricing: { subtotal: total, total },
            dispatch: { status: 'unassigned', offeredTo: [{ partnerId: rider, action: 'offered' }] },
        });
        return String(_id);
    };
    const isCashRefusal = (err) => /cash/i.test(err?.message || '') && /limit/i.test(err?.message || '');

    console.log('\na per-rider limit of Rs.100, a Rs.300 cash order');
    await setRiderLimit(100);
    const big = await cashOrder(300);
    const err = await thrownBy(() => delivery.acceptOrderDelivery(big, String(rider)));
    check('THE BUG: the rider cannot accept it', isCashRefusal(err), err?.message || 'accepted');
    check('the order is still unassigned',
        (await FoodOrder.findById(big).lean()).dispatch.status === 'unassigned');

    console.log('\na per-rider limit of Rs.1000');
    await setRiderLimit(1000);
    const small = await cashOrder(300);
    const err2 = await thrownBy(() => delivery.acceptOrderDelivery(small, String(rider)));
    check('the cash limit does not refuse it', !isCashRefusal(err2), err2?.message);
} catch (err) {
    failed += 1;
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    await mongoose.disconnect();
    await replSet.stop();
    process.exit(failed ? 1 : 0);
}
