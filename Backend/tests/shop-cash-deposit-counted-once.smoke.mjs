/**
 * The Shop's copy of the rider cash-deposit flow counts one payment once.
 *
 * Run: node tests/shop-cash-deposit-counted-once.smoke.mjs
 *
 * Same race as cash-deposit-counted-once.smoke.mjs: look up, find nothing, create
 * a Completed row, with no unique index on razorpayPaymentId. This copy also wrote
 * the CLIENT's amount (not the gateway's) when it completed an existing row.
 *
 * The gateway is a test key with Razorpay's HTTP answered locally: the SDK's
 * axios client inherits axios.defaults, so a fake adapter there plays Razorpay
 * reporting the payment captured. (Verifying with no gateway is refused now,
 * as in Food, so the offline path this file used to drive no longer exists.)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// Pinned before env.js loads, so dotenv cannot fill in real keys.
process.env.RAZORPAY_KEY_ID = 'rzp_test_smoke';
process.env.RAZORPAY_KEY_SECRET = 'smoke_secret';
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'smoke_secret').update(`${orderId}|${paymentId}`).digest('hex');

// The axios the Razorpay SDK itself loads.
const axios = createRequire(createRequire(import.meta.url).resolve('razorpay'))('axios').default;
axios.defaults.adapter = async (config) => {
    const id = String(config.url || '').split('/').pop();
    return {
        data: { id, entity: 'payment', amount: 20000, status: 'captured', order_id: 'order_dev_1' },
        status: 200, statusText: 'OK', headers: {}, config,
    };
};

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'shop_cash_deposit_once' });

    const { DeliveryPartner: QCPartner } = await import('../src/modules/ecommerce/modules/commerce/delivery/models/deliveryPartner.model.js');
    const { Order: FoodOrder } = await import('../src/modules/ecommerce/modules/commerce/orders/models/order.model.js');
    const { DeliveryCashDeposit: QCDeposit } = await import('../src/modules/ecommerce/modules/commerce/delivery/models/deliveryCashDeposit.model.js');
    const finance = await import('../src/modules/ecommerce/modules/commerce/delivery/services/deliveryFinance.service.js');
    await QCDeposit.syncIndexes();

    const rider = new mongoose.Types.ObjectId();
    await QCPartner.collection.insertOne({ _id: rider, name: 'QC Rider', phone: '9000000011', status: 'approved' });
    await FoodOrder.collection.insertOne({
        _id: new mongoose.Types.ObjectId(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: rider },
        payment: { method: 'cash' }, pricing: { total: 302 }, riderEarning: 0, createdAt: new Date(),
    });

    const p = { razorpayOrderId: 'order_dev_1', razorpayPaymentId: 'pay_dev_1', razorpaySignature: sign('order_dev_1', 'pay_dev_1'), amount: 200 };
    const completed = () => QCDeposit.countDocuments({ deliveryPartnerId: rider, status: 'Completed' });

    console.log('\none Rs 200 payment verified twice at once');
    const results = await Promise.allSettled([
        finance.verifyDeliveryCashDepositPayment(rider, p),
        finance.verifyDeliveryCashDepositPayment(rider, p),
    ]);
    await check('neither call errors', async () => {
        const errs = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
        assert.equal(errs.length, 0, `errors: ${errs.join('; ')}`);
    });
    await check('exactly one Completed deposit row', async () => {
        assert.equal(await completed(), 1, `rows ${await completed()}`);
    });
    await check('a sequential replay adds nothing', async () => {
        await finance.verifyDeliveryCashDepositPayment(rider, p);
        assert.equal(await completed(), 1);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
