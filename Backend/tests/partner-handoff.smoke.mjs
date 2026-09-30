/**
 * A partner's businesses in every service, and opening one without another
 * OTP (core/partner/partnerHandoff.service.js).
 *
 * Run: node tests/partner-handoff.smoke.mjs
 *
 * What this guards:
 *   - an OTP sign-in's pass lists every business on that phone -- Food, Quick,
 *     the Shop, Services -- with its state;
 *   - the pass opens each approved one with that service's own session;
 *   - each service's own rules still apply (a restaurant waiting for approval,
 *     a suspended vendor);
 *   - it never opens someone else's business: not by id, and not by a partner
 *     writing someone else's number on their own business (profiles let them);
 *   - a forged or expired pass is refused, and a pass is not a session.
 */
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
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
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('partner_handoff');
await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;

const partner = await import('../src/core/partner/partnerHandoff.service.js');
const { default: app } = await import('../src/app.js');

const oid = () => new mongoose.Types.ObjectId();
const MINE = '9000000001';
const THEIRS = '9000000002';
const ids = { food: oid(), foodPending: oid(), quick: oid(), shop: oid(), services: oid(), theirShop: oid(), suspended: oid() };
await db.collection('food_restaurants').insertMany([
  { _id: ids.food, restaurantName: 'Dev Kitchen', ownerPhone: `+91${MINE}`, status: 'approved' },
  { _id: ids.foodPending, restaurantName: 'Second Kitchen', ownerPhone: MINE, status: 'pending' },
]);
await db.collection('qc_restaurants').insertOne({ _id: ids.quick, restaurantName: 'Fresh Basket', primaryContactNumber: MINE, status: 'approved', tokenVersion: 0 });
await db.collection('ecom_sellers').insertMany([
  { _id: ids.shop, sellerName: 'Dev Crafts', ownerPhone: MINE, status: 'approved', tokenVersion: 0 },
  { _id: ids.theirShop, sellerName: 'Not Mine', ownerPhone: THEIRS, status: 'approved', tokenVersion: 0 },
]);
await db.collection('sp_vendors').insertMany([
  { _id: ids.services, name: 'Om', businessName: 'HomeFix', email: 'a@dev.local', phone: MINE, approvalStatus: 'approved', isActive: true },
  { _id: ids.suspended, name: 'Om', businessName: 'Old Fix', email: 'b@dev.local', phone: `91${MINE}`, approvalStatus: 'suspended', isActive: true },
]);

const pass = partner.issuePartnerPass(`+91 ${MINE}`);
const theirPass = partner.issuePartnerPass(THEIRS);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1/platform/partner`;
const call = (path, { pass: p, body } = {}) => fetch(`${base}${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { 'content-type': 'application/json', ...(p ? { 'x-partner-pass': p } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

console.log('\nFinding them');

await check('the pass lists every business on the phone, in every service', async () => {
  const { status, body } = await call('/businesses', { pass });
  assert.equal(status, 200);
  const got = body.data.items.map((b) => `${b.kind}:${b.name}:${b.state}`).sort();
  assert.deepEqual(got, [
    'food:Dev Kitchen:approved', 'food:Second Kitchen:pending', 'quick:Fresh Basket:approved',
    'services:HomeFix:approved', 'services:Old Fix:suspended', 'shop:Dev Crafts:approved',
  ]);
});

await check('no pass, or a forged one, lists nothing', async () => {
  assert.equal((await call('/businesses')).status, 401);
  const forged = jwt.sign({ p: MINE }, 'not-the-key', { audience: 'zomazo-partner-pass' });
  assert.equal((await call('/businesses', { pass: forged })).status, 401);
});

console.log('\nOpening one');

const open = (kind, id, p = pass) => call('/handoff', { pass: p, body: { kind, id: String(id) } });
const claims = (token) => jwt.decode(token);

for (const [kind, role] of [['food', 'RESTAURANT'], ['quick', 'RESTAURANT'], ['shop', 'SELLER'], ['services', 'VENDOR']]) {
  await check(`${kind}: that service's own session, for that business`, async () => {
    const { status, body } = await open(kind, ids[kind]);
    assert.equal(status, 200, JSON.stringify(body));
    const { session, home } = body.data;
    assert.ok(session.accessToken && session.refreshToken);
    assert.equal(claims(session.accessToken).userId, String(ids[kind]));
    assert.equal(claims(session.accessToken).role, role);
    assert.ok(home.startsWith('/'));
  });
}

await check('each service\'s own rules still apply', async () => {
  const pending = await open('food', ids.foodPending);
  assert.equal(pending.status, 403);
  const suspended = await open('services', ids.suspended);
  assert.equal(suspended.status, 403);
  assert.match(suspended.body.message, /suspended/);
});

await check('never someone else\'s business', async () => {
  assert.equal((await open('shop', ids.theirShop)).status, 404);
  // Writing my number on their business would need their session; writing
  // their number on mine does not give me theirs: the pass is for MY number.
  await db.collection('ecom_sellers').updateOne({ _id: ids.shop }, { $set: { ownerPhone: THEIRS } });
  assert.equal((await open('shop', ids.theirShop)).status, 404);
  // ...and whoever holds THEIRS now reaches the business I relabelled -- as
  // their OTP sign-in to the Shop already would.
  assert.equal((await open('shop', ids.shop, theirPass)).status, 200);
  await db.collection('ecom_sellers').updateOne({ _id: ids.shop }, { $set: { ownerPhone: MINE } });
});

await check('a pass is not a session anywhere', async () => {
  const { verifyAccessToken } = await import('../src/core/auth/token.util.js');
  assert.throws(() => verifyAccessToken(pass));
  const me = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${pass}` } });
  assert.equal(me.status, 401);
});

await check('an unknown kind or a bad id is simply not found', async () => {
  assert.equal((await open('taxi', ids.food)).status, 404);
  assert.equal((await open('food', 'nope')).status, 404);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll partner handoff checks passed');
process.exit(failed ? 1 : 0);
