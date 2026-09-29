/**
 * A rejected Quick store or rider, or Shop seller, is refused on every request,
 * not only at their next sign-in.
 *
 * Run: node tests/rejected-partner-refused.smoke.mjs
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
process.env.MONGODB_URI = mongo.getUri('rejected_partner');
await mongoose.connect(mongo.getUri('rejected_partner'));

const { signAccessToken } = await import('../src/core/auth/token.util.js');
const qcAuth = await import('../src/modules/quickCommerce/core/auth/auth.middleware.js');
const shopAuth = await import('../src/modules/ecommerce/core/auth/auth.middleware.js');
const { FoodRestaurant: QCStore } = await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
const { Seller } = await import('../src/modules/ecommerce/modules/commerce/seller/models/seller.model.js');

// Runs a middleware and reports the status it answered with, or 'next'.
const run = (mw, token) => new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` }, method: 'GET', path: '/' };
    const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json() { resolve(this.statusCode); return this; },
        send() { resolve(this.statusCode); return this; },
    };
    mw(req, res, (err) => resolve(err ? (err.statusCode || 500) : 'next'));
});
const token = (id, role) => signAccessToken({ userId: String(id), role });

await check('Quick: a rejected store is refused; a pending one gets through', async () => {
    const rejected = await QCStore.collection.insertOne({ restaurantName: 'Gone', status: 'rejected' });
    const pending = await QCStore.collection.insertOne({ restaurantName: 'New', status: 'pending' });
    assert.equal(await run(qcAuth.authMiddleware, token(rejected.insertedId, 'RESTAURANT')), 403);
    assert.equal(await run(qcAuth.authMiddleware, token(pending.insertedId, 'RESTAURANT')), 'next');
});

await check('Shop: a rejected seller is refused; an approved one gets through', async () => {
    const rejected = await Seller.collection.insertOne({ sellerName: 'Gone', status: 'rejected' });
    const approved = await Seller.collection.insertOne({ sellerName: 'Open', status: 'approved' });
    assert.equal(await run(shopAuth.authMiddleware, token(rejected.insertedId, 'SELLER')), 403);
    assert.equal(await run(shopAuth.authMiddleware, token(approved.insertedId, 'SELLER')), 'next');
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll rejected-partner checks passed');
process.exit(0);
