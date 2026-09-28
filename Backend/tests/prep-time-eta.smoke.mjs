/**
 * The prep time a restaurant gives when it accepts reaches the customer ETA.
 *
 * Run: node tests/prep-time-eta.smoke.mjs
 *
 * What this guards:
 *   - the accept call's prepTimeMins passes validation and is stored with the
 *     moment the food should be ready (Food, via the real service);
 *   - the Food ETA counts down that time instead of the flat 15-minute default,
 *     and a rider arriving early waits for the kitchen;
 *   - the Quick delivery promise uses the store's time instead of flat packing;
 *   - bad values are refused.
 */
import { startFoodWorld, makeChecker, thrownBy } from './food-order-fixture.mjs';

const w = await startFoodWorld('prep_time');
const { check, summary } = makeChecker();
let failed = 1;

try {
    const foodValidators = await import('../src/modules/food/orders/validators/order.validator.js');
    const qcValidators = await import('../src/modules/quickCommerce/modules/food/orders/validators/order.validator.js');
    const { buildOrderEta, remainingPrepMinutes } = await import('../src/modules/food/orders/services/orderEta.service.js');
    const { buildLiveEta } = await import('../src/modules/quickCommerce/modules/food/orders/services/order.helpers.js');

    console.log('\nvalidation');
    for (const [name, v] of [['food', foodValidators], ['quick', qcValidators]]) {
        const ok = v.validateOrderStatusDto({ orderStatus: 'preparing', prepTimeMins: '25' });
        check(`${name}: prepTimeMins accepted and coerced`, ok.prepTimeMins === 25, ok.prepTimeMins);
        check(`${name}: null is the same as absent`, v.validateOrderStatusDto({ orderStatus: 'preparing', prepTimeMins: null }).prepTimeMins === undefined);
        check(`${name}: 0 refused`, Boolean(await thrownBy(() => v.validateOrderStatusDto({ orderStatus: 'preparing', prepTimeMins: 0 }))));
        check(`${name}: 500 refused`, Boolean(await thrownBy(() => v.validateOrderStatusDto({ orderStatus: 'preparing', prepTimeMins: 500 }))));
    }

    console.log('\nfood accept stores it');
    const buyer = await w.makeUser();
    const items = [w.appLine(w.dish)];
    const placed = await w.saved(await w.place(buyer._id, { items, pricing: await w.quote(buyer._id, { items }) }));
    await w.m.FoodOrder.updateOne({ _id: placed._id }, { $set: { restaurantReleaseAt: null, orderStatus: 'created' } });
    const before = Date.now();
    await w.orderService.updateOrderStatusRestaurant(String(placed._id), String(w.restaurant._id), 'preparing', '', undefined, { prepTimeMins: 35 });
    const accepted = await w.m.FoodOrder.findById(placed._id).lean();
    check('prepTimeMins stored', accepted.prepTimeMins === 35, accepted.prepTimeMins);
    const readyIn = (new Date(accepted.estimatedReadyAt).getTime() - before) / 60000;
    check('ready time is 35 minutes out', readyIn > 34.9 && readyIn < 35.1, readyIn);
    check('remaining prep reads 35', remainingPrepMinutes(accepted) === 35, remainingPrepMinutes(accepted));

    console.log('\nfood ETA');
    const restaurant = { location: { type: 'Point', coordinates: [76.53, 32.11] } };
    const customer = { location: { type: 'Point', coordinates: [76.55, 32.12] } };
    const base = { orderStatus: 'preparing', restaurantId: restaurant, deliveryAddress: customer };
    const noTime = buildOrderEta(base);
    const withTime = buildOrderEta({ ...base, estimatedReadyAt: new Date(Date.now() + 40 * 60000) });
    check('without a time: flat default plus trip', noTime.source === 'estimate' && noTime.minutes > 15 && noTime.minutes < 30, noTime.minutes);
    check('with 40 minutes: 40 plus the trip', withTime.minutes - noTime.minutes === 25, `${withTime.minutes} vs ${noTime.minutes}`);
    const riderNear = { lastRiderLocation: { type: 'Point', coordinates: [76.531, 32.111] } };
    const live = buildOrderEta({ ...base, ...riderNear, estimatedReadyAt: new Date(Date.now() + 30 * 60000) });
    check('rider at the door waits for the kitchen', live.source === 'live' && live.minutes >= 30, live.minutes);
    const cooked = buildOrderEta({ ...base, orderStatus: 'ready_for_pickup', estimatedReadyAt: new Date(Date.now() + 30 * 60000) });
    check('once ready, the kitchen time no longer counts', cooked.minutes < 15, cooked.minutes);

    console.log('\nquick delivery promise');
    const qcBase = { orderStatus: 'preparing', pricing: { roadDurationMins: 10 } };
    const flat = buildLiveEta(qcBase);
    const store = buildLiveEta({ ...qcBase, estimatedReadyAt: new Date(Date.now() + 12 * 60000) });
    check('flat packing without a store time', flat.promiseMinutes === 13, flat.promiseMinutes);
    check('store time used when given', store.promiseMinutes === 22, store.promiseMinutes);

    failed = summary();
} catch (err) {
    console.error(err);
} finally {
    await w.stop();
    process.exit(failed ? 1 : 0);
}
