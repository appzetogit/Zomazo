/**
 * Quick: rejecting a seller or a rider revokes its refresh tokens, so it can
 * no longer mint fresh access tokens.
 *
 * Run: node tests/qc-reject-signs-out.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('qc_reject_signout');
await mongoose.connect(mongo.getUri('qc_reject_signout'));

const svc = await import('../src/modules/quickCommerce/modules/food/admin/services/admin.service.js');
const { QCRefreshToken } = await import('../src/core/refreshTokens/refreshToken.model.js');
const { FoodRestaurant } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');

const expiresAt = new Date(Date.now() + 86400000);

await check('a rejected seller loses its refresh tokens', async () => {
    const _id = new mongoose.Types.ObjectId();
    await FoodRestaurant.collection.insertOne({ _id, restaurantName: 'Mart', status: 'approved' });
    await QCRefreshToken.collection.insertOne({ userId: _id, token: `seller-${_id}`, expiresAt });
    await svc.rejectRestaurant(String(_id), 'fake documents');
    assert.equal(await QCRefreshToken.countDocuments({ userId: _id }), 0);
});

await check('a rejected rider loses its refresh tokens', async () => {
    const _id = new mongoose.Types.ObjectId();
    await FoodDeliveryPartner.collection.insertOne({ _id, name: 'Rider', phone: '9000000001', status: 'approved' });
    await QCRefreshToken.collection.insertOne({ userId: _id, token: `rider-${_id}`, expiresAt });
    await svc.rejectDeliveryPartner(String(_id), 'fake documents');
    assert.equal(await QCRefreshToken.countDocuments({ userId: _id }), 0);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
