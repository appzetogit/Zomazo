/**
 * A rider can pass on a broadcast food offer.
 *
 * Run: node tests/food-rider-pass-offer.smoke.mjs
 *
 * Offers are broadcast: the order stays unassigned while every nearby rider
 * sees it. rejectOrderDelivery only accepted a rider the order was assigned to,
 * so "Pass this task" in the rider app was refused for every broadcast offer
 * and the pass was never recorded. Drives the real service against an
 * in-memory Mongo.
 */
import mongoose from 'mongoose';
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('rider_pass_offer');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const items = [w.appLine(w.dish)];
    const buyer = await w.makeUser();
    const other = new mongoose.Types.ObjectId();
    const offeredOrder = async (dispatch) => {
        const order = await w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
        await w.m.FoodOrder.updateOne({ _id: order._id }, { $set: { orderStatus: 'preparing', ...dispatch } });
        return String(order._id);
    };
    const offersOf = async (id) => (await w.m.FoodOrder.findById(id).lean()).dispatch.offeredTo;
    const pass = (id, riderId = w.rider._id) => w.orderService.rejectOrderDelivery(id, String(riderId));

    console.log('\na broadcast offer to two riders');
    const broadcast = await offeredOrder({
        'dispatch.status': 'unassigned',
        'dispatch.deliveryPartnerId': null,
        'dispatch.offeredTo': [
            { partnerId: w.rider._id, action: 'offered' },
            { partnerId: other, action: 'offered' },
        ],
    });
    const err = await thrownBy(() => pass(broadcast));
    check('THE BUG: the rider may pass on it', !err, err?.message || 'passed');
    const offers = await offersOf(broadcast);
    check('their offer is marked rejected',
        offers.find((o) => String(o.partnerId) === String(w.rider._id))?.action === 'rejected');
    check('the other rider still has it',
        offers.find((o) => String(o.partnerId) === String(other))?.action === 'offered');

    console.log('\nan order another rider holds');
    const held = await offeredOrder({
        'dispatch.status': 'accepted',
        'dispatch.deliveryPartnerId': other,
        'dispatch.offeredTo': [{ partnerId: w.rider._id, action: 'offered' }],
    });
    const refused = await thrownBy(() => pass(held));
    check('the rider cannot reject it', Boolean(refused), refused?.message || 'rejected');

    console.log('\nan order assigned to the rider');
    const assigned = await offeredOrder({
        'dispatch.status': 'assigned',
        'dispatch.deliveryPartnerId': w.rider._id,
        'dispatch.offeredTo': [{ partnerId: w.rider._id, action: 'offered' }],
    });
    await pass(assigned);
    const after = (await w.m.FoodOrder.findById(assigned).lean()).dispatch;
    check('it is released back to unassigned', after.status === 'unassigned' && !after.deliveryPartnerId, after.status);

    failed = summary();
} catch (err) {
    console.log(`\n  UNCAUGHT: ${err.stack || err.message}`);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
