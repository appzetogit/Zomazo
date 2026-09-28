/**
 * Shop and Quick riders' withdrawals go only to the account on file, and pause for a day
 * after payout details change.
 *
 * Run: node tests/rider-payout-on-file.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('shop_rider_payout');
await mongoose.connect(mongo.getUri('shop_rider_payout'));

const { DeliveryPartner } = await import('../src/modules/ecommerce/modules/commerce/delivery/models/deliveryPartner.model.js');
const { requestDeliveryWithdrawal } = await import('../src/modules/ecommerce/modules/commerce/delivery/services/deliveryFinance.service.js');
const { updateDeliveryPartnerBankDetails } = await import('../src/modules/ecommerce/modules/commerce/delivery/services/delivery.service.js');

const riderId = new mongoose.Types.ObjectId();
await DeliveryPartner.collection.insertOne({ _id: riderId, name: 'Rider', phone: '9000000077', bankAccountNumber: '111122223333', bankIfscCode: 'HDFC0000001' });

await check('a withdrawal to an account other than the one on file is refused', async () => {
    await assert.rejects(
        requestDeliveryWithdrawal(String(riderId), { amount: 500, bankDetails: { accountNumber: '999988887777' } }),
        /bank account in your profile/,
    );
});

await check('setting details for the first time does not pause withdrawals', async () => {
    const fresh = new mongoose.Types.ObjectId();
    await DeliveryPartner.collection.insertOne({ _id: fresh, name: 'New', phone: '9000000078' });
    await updateDeliveryPartnerBankDetails(String(fresh), { documents: { bankDetails: { accountNumber: '5555', ifscCode: 'SBIN0000001' } } });
    assert.equal((await DeliveryPartner.collection.findOne({ _id: fresh })).bankDetailsChangedAt ?? null, null);
});

await check('changing the account pauses withdrawals for about a day', async () => {
    await updateDeliveryPartnerBankDetails(String(riderId), { documents: { bankDetails: { accountNumber: '444455556666' } } });
    assert.ok((await DeliveryPartner.collection.findOne({ _id: riderId })).bankDetailsChangedAt);
    await assert.rejects(requestDeliveryWithdrawal(String(riderId), { amount: 500 }), /changed recently.*24 hours/);
});

const qc = {
    partner: (await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner,
    finance: await import('../src/modules/quickCommerce/modules/food/delivery/services/deliveryFinance.service.js'),
    profile: await import('../src/modules/quickCommerce/modules/food/delivery/services/delivery.service.js'),
};
const qcRider = new mongoose.Types.ObjectId();
await qc.partner.collection.insertOne({ _id: qcRider, name: 'QC rider', phone: '9000000079', bankAccountNumber: '121212121212' });

await check('Quick: a withdrawal to another account is refused, and a change pauses it', async () => {
    await assert.rejects(qc.finance.requestDeliveryWithdrawal(String(qcRider), { amount: 500, bankDetails: { accountNumber: '999' } }), /bank account in your profile/);
    await qc.profile.updateDeliveryPartnerBankDetails(String(qcRider), { documents: { bankDetails: { accountNumber: '343434343434' } } });
    await assert.rejects(qc.finance.requestDeliveryWithdrawal(String(qcRider), { amount: 500 }), /changed recently/);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll rider payout checks passed');
process.exit(0);
