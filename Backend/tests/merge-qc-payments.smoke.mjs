/**
 * Quick commerce's refunds, settlements and entity transactions moved into the
 * core collections, marked vertical 'quickCommerce'.
 *
 * Run: node tests/merge-qc-payments.smoke.mjs
 *
 * Seeds rows in qc_refunds / qc_settlements / qc_entity_transactions beside the
 * core's own rows, then: Quick's lists see the old rows before the script and
 * Food's never see Quick's; a pending settlement processed before the script
 * is copied and settled once; the dry run writes nothing; --apply copies
 * (same _id) and running it again changes nothing; the reports read the same
 * after; --drop-old retires the old collections.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

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

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());
const db = mongoose.connection;
// Transactions cannot create collections: make the ones the ledger writes.
for (const c of ['transactions', 'refunds', 'settlements', 'qc_delivery_wallets', 'qc_restaurant_wallets', 'qc_payment_id_map']) {
    await db.createCollection(c).catch(() => {});
}

const { mergeQcPayments } = await import('../scripts/migrations/mergeQcPayments.mjs');
const quickRefunds = await import('../src/modules/quickCommerce/core/payments/refund.service.js');
const quickSettlements = await import('../src/modules/quickCommerce/core/payments/settlement.service.js');
const quickTx = await import('../src/modules/quickCommerce/core/payments/transaction.service.js');
const foodRefunds = await import('../src/core/payments/refund.service.js');
const foodSettlements = await import('../src/core/payments/settlement.service.js');
const { clearReadThroughCache } = await import('../src/core/payments/models/verticalPayments.js');
await import('../src/modules/quickCommerce/modules/food/delivery/models/deliveryWallet.model.js');
await import('../src/modules/quickCommerce/modules/food/restaurant/models/restaurantWallet.model.js');
// Index builds finish before the ledger's transactions start.
await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

const oid = () => new mongoose.Types.ObjectId();
const order = oid();
const rider = oid();
const t = (m) => new Date(Date.UTC(2026, 8, 1, 10, m));

const qcRefund = { _id: oid(), paymentId: oid(), orderId: order, userId: oid(), amount: 120, status: 'processed', refundTo: 'wallet', createdAt: t(1) };
const qcRefund2 = { _id: oid(), paymentId: oid(), orderId: oid(), userId: oid(), amount: 40, status: 'pending', refundTo: 'gateway', createdAt: t(2) };
const foodRefund = { _id: oid(), paymentId: oid(), orderId: oid(), userId: oid(), amount: 999, status: 'processed', refundTo: 'wallet', createdAt: t(3) };
await db.collection('qc_refunds').insertMany([qcRefund, qcRefund2]);
await db.collection('refunds').insertOne(foodRefund);
const qcSettlement = { _id: oid(), entityType: 'deliveryBoy', entityId: rider, amount: 300, status: 'pending', transactionIds: [], createdAt: t(4) };
await db.collection('qc_settlements').insertOne(qcSettlement);
await db.collection('settlements').insertOne({ _id: oid(), entityType: 'restaurant', entityId: oid(), amount: 5, status: 'pending', transactionIds: [], createdAt: t(5) });
const qcTx = { _id: oid(), orderId: order, entityType: 'deliveryBoy', entityId: rider, type: 'credit', amount: 500, balanceAfter: 500, status: 'completed', createdAt: t(6) };
await db.collection('qc_entity_transactions').insertOne(qcTx);
await db.collection('qc_delivery_wallets').insertOne({ deliveryPartnerId: rider, balance: 500, lockedAmount: 0 });

const ids = (rows) => rows.map((r) => String(r._id)).sort();
const snapshot = async () => {
    const out = {};
    for (const { name } of await db.db.listCollections().toArray()) {
        out[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    }
    return out;
};
const quiet = { log: () => {} };

console.log('\nBefore the script runs');
await check('Quick\'s lists see the old rows; Food\'s lists never see Quick\'s', async () => {
    const q = await quickRefunds.listRefunds({});
    assert.deepEqual(ids(q.refunds), ids([qcRefund, qcRefund2]));
    assert.equal(q.total, 2);
    assert.deepEqual(ids(await quickRefunds.getRefundsByOrder(String(order))), [String(qcRefund._id)]);
    const f = await foodRefunds.listRefunds({});
    assert.deepEqual(ids(f.refunds), [String(foodRefund._id)]);
    assert.deepEqual(ids(await quickTx.getTransactionsByOrder(String(order))), [String(qcTx._id)]);
});
await check('a pending settlement processed before the script is copied and paid once', async () => {
    const s = await quickSettlements.processSettlement(String(qcSettlement._id), { payoutRef: 'UTR1' });
    assert.equal(s.status, 'processed');
    const copied = await db.collection('settlements').findOne({ _id: qcSettlement._id });
    assert.equal(copied.vertical, 'quickCommerce');
    assert.equal(copied.status, 'processed');
    assert.equal((await db.collection('qc_delivery_wallets').findOne({ deliveryPartnerId: rider })).balance, 200);
    const again = await quickSettlements.processSettlement(String(qcSettlement._id), { payoutRef: 'UTR1' });
    assert.equal(again.status, 'processed');
    assert.equal((await db.collection('qc_delivery_wallets').findOne({ deliveryPartnerId: rider })).balance, 200, 'not paid twice');
    const debit = await db.collection('transactions').findOne({ entityId: rider, type: 'debit' });
    assert.equal(debit?.vertical, 'quickCommerce', 'a new ledger row is written to the core collection, marked');
    const fs = await foodSettlements.listSettlements({});
    assert.equal(fs.total, 1, 'Food\'s settlements do not include Quick\'s');
});

console.log('\nDry run and apply');
await check('the dry run writes nothing', async () => {
    const before = await snapshot();
    const r = await mergeQcPayments({ ...quiet });
    assert.equal(r.qc_refunds.toCopy, 2);
    assert.equal(r.qc_settlements.toCopy, 0, 'already copied when it was processed');
    assert.equal(r.qc_entity_transactions.toCopy, 1);
    assert.deepEqual(await snapshot(), before);
});
await check('--apply copies every row with its _id, marked', async () => {
    const r = await mergeQcPayments({ apply: true, ...quiet });
    assert.equal(r.qc_refunds.copied, 2);
    for (const x of [qcRefund, qcRefund2]) {
        assert.equal((await db.collection('refunds').findOne({ _id: x._id })).vertical, 'quickCommerce');
    }
    assert.equal((await db.collection('transactions').findOne({ _id: qcTx._id })).vertical, 'quickCommerce');
    assert.ok(await db.collection('qc_payment_id_map').findOne({ _id: qcRefund._id }));
});
await check('running --apply again changes nothing', async () => {
    const before = await snapshot();
    const r = await mergeQcPayments({ apply: true, ...quiet });
    assert.equal(r.qc_refunds.copied, 0);
    const after = await snapshot();
    delete before.qc_payment_id_map; delete after.qc_payment_id_map; // marker timestamps
    assert.deepEqual(after, before);
});

console.log('\nAfter');
await check('the reports read the same, and stay apart', async () => {
    clearReadThroughCache();
    const q = await quickRefunds.listRefunds({});
    assert.deepEqual(ids(q.refunds), ids([qcRefund, qcRefund2]));
    assert.equal(q.total, 2);
    const s = await quickSettlements.listSettlements({});
    assert.deepEqual(ids(s.settlements), [String(qcSettlement._id)]);
    const tx = await quickTx.getTransactionsByEntity('deliveryBoy', String(rider));
    assert.equal(tx.total, 2);
    const f = await foodRefunds.listRefunds({});
    assert.deepEqual(ids(f.refunds), [String(foodRefund._id)]);
});
await check('--drop-old retires the old collections; Quick still reads its rows', async () => {
    const r = await mergeQcPayments({ dropOld: true, ...quiet });
    assert.ok(r.qc_refunds.renamed && r.qc_settlements.renamed && r.qc_entity_transactions.renamed, JSON.stringify(r));
    clearReadThroughCache();
    assert.equal((await quickRefunds.listRefunds({})).total, 2);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
