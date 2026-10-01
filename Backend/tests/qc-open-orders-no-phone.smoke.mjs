/**
 * Quick-commerce riders' open-order list carries no customer contact details.
 *
 * Run: node tests/qc-open-orders-no-phone.smoke.mjs
 *
 * GET /delivery/orders/available returned each open order with the customer's
 * phone and email (populated user, customerPhone, address phone), so any rider
 * could collect them. An offer now carries name and address only; the rider's
 * own order keeps full contact details. Food was fixed in 2aff2c7e.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
};

process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'qc_open_orders_privacy' });

try {
    const BASE = '../src/modules/quickCommerce/modules/food';
    await import('../src/modules/quickCommerce/core/users/user.model.js');
    const delivery = await import(`${BASE}/orders/services/order-delivery.service.js`);
    const { FoodOrder } = await import(`${BASE}/orders/models/order.model.js`);

    const rider = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    // Quick's customers are in the shared users collection (the qc_users merge).
    await mongoose.connection.collection('users').insertOne({
        _id: userId, name: 'Asha', phone: '9000000001', email: 'asha@example.test',
    });
    const insert = async (dispatch, orderStatus = 'preparing') => {
        const _id = new mongoose.Types.ObjectId();
        await FoodOrder.collection.insertOne({
            _id, orderId: `QC-${_id}`, orderStatus, dispatch, userId,
            restaurantId: new mongoose.Types.ObjectId(),
            customerPhone: '9000000001',
            deliveryAddress: { label: 'Home', street: '1 Test Rd', city: 'Indore', phone: '9000000001' },
            items: [{ itemId: new mongoose.Types.ObjectId(), name: 'Milk', price: 30, quantity: 1 }],
            createdAt: new Date(),
        });
        return String(_id);
    };
    const offer = await insert({ status: 'unassigned', offeredTo: [{ partnerId: rider, action: 'offered' }] });
    const mine = await insert({ status: 'assigned', deliveryPartnerId: rider, offeredTo: [] });

    const { data: docs } = await delivery.listOrdersAvailableDelivery(String(rider), {});
    const find = (id) => docs.find((d) => String(d._id) === id);
    const o = find(offer);
    check('the offer is listed', Boolean(o), `listed: ${docs.map((d) => d._id).join(', ')}`);
    const text = JSON.stringify(o || {});
    check('THE BUG: the offer carries no phone', !text.includes('9000000001'), text);
    check('the offer carries no email', !text.includes('asha@example.test'));
    check('the offer keeps the customer name', o?.userId?.name === 'Asha');
    const m = find(mine);
    check('the rider\'s own order keeps the phone',
        m?.userId?.phone === '9000000001' && m?.deliveryAddress?.phone === '9000000001', JSON.stringify(m));
} catch (err) {
    failed += 1;
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(failed ? 1 : 0);
}
