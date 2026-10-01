/**
 * Services admin: a worker's payment history (GET /admin/workers/:id/earnings),
 * which used to answer a fixed zero.
 *
 * Run: node tests/sp-worker-earnings.smoke.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);

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
await mongoose.connect(mongo.getUri('sp_worker_earnings'));
const db = mongoose.connection;
const { getWorkerEarnings } = require('../src/modules/serviceProvider/controllers/adminControllers/adminWorkerController.js');

const call = async (params, query = {}) => {
  let status = 200;
  let body = null;
  const res = { status(code) { status = code; return this; }, json(b) { body = b; return this; } };
  await getWorkerEarnings({ params, query }, res);
  return { status, body };
};

const worker = new mongoose.Types.ObjectId();
await db.collection('sp_workers').insertOne({ _id: worker, name: 'Ravi', phone: '9000000102', wallet: { balance: 450, earnings: 1200, dues: 50 } });
const day = (n) => new Date(Date.now() - n * 86400000);
await db.collection('sp_transactions').insertMany([
  { workerId: worker, type: 'earnings_credit', amount: 700, status: 'completed', description: 'Booking #1', createdAt: day(20) },
  { workerId: worker, type: 'earnings_credit', amount: 500, status: 'completed', description: 'Booking #2', createdAt: day(2) },
  { workerId: worker, type: 'withdrawal', amount: 300, status: 'completed', description: 'Paid out', createdAt: day(1) },
  { workerId: worker, type: 'earnings_credit', amount: 999, status: 'failed', description: 'Failed one', createdAt: day(1) },
  { workerId: new mongoose.Types.ObjectId(), type: 'earnings_credit', amount: 5000, status: 'completed', description: 'Someone else', createdAt: day(1) },
]);

await check('the worker\'s own transactions, newest first, with the wallet', async () => {
  const { status, body } = await call({ id: String(worker) });
  assert.equal(status, 200);
  assert.deepEqual(body.data.wallet, { balance: 450, totalEarnings: 1200, dues: 50 });
  assert.equal(body.data.transactions.length, 4);
  assert.equal(body.data.transactions[0].description === 'Paid out' || body.data.transactions[0].description === 'Failed one', true);
  assert.equal(body.data.periodEarnings, 1200); // the failed credit does not count
  assert.equal(body.data.periodPaidOut, 300);
});

await check('a date range narrows the list and its totals', async () => {
  const startDate = day(5).toISOString().slice(0, 10);
  const { body } = await call({ id: String(worker) }, { startDate });
  assert.equal(body.data.transactions.length, 3);
  assert.equal(body.data.periodEarnings, 500);
});

await check('bad or unknown ids are refused', async () => {
  assert.equal((await call({ id: 'nope' })).status, 400);
  assert.equal((await call({ id: String(new mongoose.Types.ObjectId()) })).status, 404);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll worker earnings checks passed');
process.exit(failed ? 1 : 0);
