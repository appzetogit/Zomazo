/**
 * A quick-commerce rider can pass on a broadcast offer.
 *
 * Run: node tests/qc-rider-pass-offer.smoke.mjs
 *
 * Offers are broadcast: the order stays unassigned while every nearby rider
 * sees it. rejectOrderDelivery only accepted the rider the order was assigned
 * to, so a pass on a broadcast offer was refused and never recorded. Food was
 * fixed in 221f5fb9; this pins the quick-commerce fork.
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
await mongoose.connect(mongo.getUri(), { dbName: 'qc_rider_pass' });

try {
    const BASE = '../src/modules/quickCommerce/modules/food';
    const delivery = await import(`${BASE}/orders/services/order-delivery.service.js`);
    const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);

    const rider = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    // Raw inserts: only the dispatch state matters to this path.
    const orderWith = async (dispatch) => {
        const _id = new mongoose.Types.ObjectId();
        await FoodOrder.collection.insertOne({
            _id, orderId: `QC-${_id}`, orderStatus: 'preparing', dispatch,
            userId: new mongoose.Types.ObjectId(),
            restaurantId: new mongoose.Types.ObjectId(),
            deliveryAddress: { label: 'Home', street: '1 Test Rd', city: 'Indore', state: 'MP' },
            items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Milk', price: 30, quantity: 1 }],
        });
        return String(_id);
    };
    const offersOf = async (id) => (await FoodOrder.findById(id).lean()).dispatch.offeredTo;

    console.log('\na broadcast offer to two riders');
    const broadcast = await orderWith({
        status: 'unassigned',
        deliveryPartnerId: null,
        offeredTo: [
            { partnerId: rider, action: 'offered' },
            { partnerId: other, action: 'offered' },
        ],
    });
    const err = await thrownBy(() => delivery.rejectOrderDelivery(broadcast, String(rider)));
    check('THE BUG: the rider may pass on it', !err, err?.message);
    const offers = await offersOf(broadcast);
    check('their offer is marked rejected',
        offers.find((o) => String(o.partnerId) === String(rider))?.action === 'rejected');
    check('the other rider still has it',
        offers.find((o) => String(o.partnerId) === String(other))?.action === 'offered');

    console.log('\nan order another rider holds');
    const held = await orderWith({
        status: 'accepted',
        deliveryPartnerId: other,
        offeredTo: [{ partnerId: rider, action: 'offered' }],
    });
    const refused = await thrownBy(() => delivery.rejectOrderDelivery(held, String(rider)));
    check('the rider cannot reject it', Boolean(refused), 'was allowed');
    check('the holder keeps it',
        String((await FoodOrder.findById(held).lean()).dispatch.deliveryPartnerId) === String(other));
} catch (err) {
    failed += 1;
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(failed ? 1 : 0);
}
