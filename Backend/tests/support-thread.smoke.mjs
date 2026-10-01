/**
 * Support tickets keep the whole conversation (core/support/supportThread.js).
 *
 * Run: node tests/support-thread.smoke.mjs
 *
 * What this guards:
 *   - two admin replies are both kept, in order, and the service still gets
 *     the latest one as its single answer;
 *   - an old ticket's single answer shows as the first admin message, and
 *     keeps that place once new messages are added;
 *   - the customer sees the thread and writes back, which reopens the
 *     ticket; nobody else's ticket can be read or answered.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('support_thread'));
const db = mongoose.connection;

const inbox = await import('../src/core/support/supportInbox.service.js');
const help = await import('../src/core/support/customerSupport.service.js');
const { FoodSupportTicket } = await import('../src/modules/food/user/models/supportTicket.model.js');

const oid = () => new mongoose.Types.ObjectId();
const owner = { _id: oid(), name: 'Asha', role: 'ADMIN', adminLevel: 'platform_superadmin' };
const me = oid();
const stranger = oid();
await db.collection('users').insertMany([{ _id: me, phone: '9000000001' }, { _id: stranger, phone: '9000000002' }]);

const fresh = await FoodSupportTicket.create({ userId: me, type: 'other', issueType: 'Refund', description: 'Where is my refund?' });
const old = await FoodSupportTicket.create({
  userId: me, type: 'other', issueType: 'Late', description: 'Order was late', adminResponse: 'Sorry, credited Rs 50', status: 'resolved',
});

const texts = (t) => t.messages.map((m) => `${m.from}:${m.message}`);

await check('two admin replies are both kept, in order', async () => {
  await inbox.updateInboxTicket(owner, 'food_customer', String(fresh._id), { reply: 'Looking into it' });
  const t = await inbox.updateInboxTicket(owner, 'food_customer', String(fresh._id), { reply: 'Refund sent today' });
  assert.deepEqual(texts(t), ['requester:Where is my refund?', 'admin:Looking into it', 'admin:Refund sent today']);
  assert.equal(t.messages[1].name, 'Asha');
  // The service's own field still holds the latest answer.
  assert.equal((await FoodSupportTicket.findById(fresh._id).lean()).adminResponse, 'Refund sent today');
});

await check('an old ticket shows its single answer as the first admin message', async () => {
  const t = await inbox.getInboxTicket(owner, 'food_customer', String(old._id));
  assert.deepEqual(texts(t), ['requester:Order was late', 'admin:Sorry, credited Rs 50']);
});

await check('the customer sees the thread and writes back; the old answer keeps its place', async () => {
  const t = await help.replyCustomerTicket(String(me), `food:${old._id}`, { message: 'Not received yet' });
  assert.deepEqual(texts(t), ['requester:Order was late', 'admin:Sorry, credited Rs 50', 'requester:Not received yet']);
  assert.equal(t.status, 'open');
  const again = await inbox.updateInboxTicket(owner, 'food_customer', String(old._id), { reply: 'Sent again' });
  assert.deepEqual(texts(again).slice(1), ['admin:Sorry, credited Rs 50', 'requester:Not received yet', 'admin:Sent again']);
});

await check('nobody else can read or answer the ticket', async () => {
  await assert.rejects(() => help.getCustomerTicket(String(stranger), `food:${old._id}`), (e) => e.statusCode === 404);
  await assert.rejects(() => help.replyCustomerTicket(String(stranger), `food:${old._id}`, { message: 'hi' }), (e) => e.statusCode === 404);
  await assert.rejects(() => help.replyCustomerTicket(String(me), `food:${old._id}`, { message: '  ' }), (e) => e.statusCode === 400);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
