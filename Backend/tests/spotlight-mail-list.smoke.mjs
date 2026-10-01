/**
 * Partner ads (core/spotlight) and the newsletter list (core/mailingList).
 *
 * Run: node tests/spotlight-mail-list.smoke.mjs
 *
 * What this guards:
 *   - a partner's request is checked (kind, title, dates, link, image for a
 *     banner) and capped while undecided; only their own can be withdrawn;
 *   - an admin approves, or rejects with a reason; a decided request cannot be
 *     decided again; pause / resume / edit work on approved ones;
 *   - running / scheduled / expired / paused are worked out from the dates;
 *   - an approved banner inside its dates appears in that service's public
 *     home promotion strip, and disappears when paused; promoted listings are
 *     served publicly;
 *   - admins see only services they hold "Offers & coupons" for;
 *   - subscribing is public, validated, idempotent, and the same answer either
 *     way; unsubscribing by link works; resubscribing restores;
 *   - the admin list filters by search, source and date, exports CSV with
 *     formula cells neutralised, and needs Customers access.
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
const rejects = async (fn, status) => {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.statusCode, status, err.message);
    return err;
  }
  throw new Error(`expected ${status}`);
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = process.env.MONGO_URI = mongo.getUri('spotlight');
await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;

const spotlight = await import('../src/core/spotlight/spotlight.service.js');
const mail = await import('../src/core/mailingList/mailingList.service.js');
const { MailSubscriber } = await import('../src/core/mailingList/mailSubscriber.model.js');
const { SpotlightAd } = await import('../src/core/spotlight/spotlightAd.model.js');
const { default: app } = await import('../src/app.js');

const oid = () => new mongoose.Types.ObjectId();
const day = 24 * 3600 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const kitchen = oid();
const other = oid();
const seller = oid();
await db.collection('food_restaurants').insertMany([
  { _id: kitchen, restaurantName: 'Dev Kitchen', status: 'approved' },
  { _id: other, restaurantName: 'Other Kitchen', status: 'approved' },
]);
await db.collection('ecom_sellers').insertOne({ _id: seller, sellerName: 'Dev Crafts', status: 'approved' });

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const sub = (services, permissions) => ({
  _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: services, permissions,
});
const foodPromoReader = sub(['food'], ['promotions.read']);

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
const call = (path, body) => fetch(`${base}${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, text: await r.text() }));

console.log('\nAsking for an ad');
let listingId;
await check('a promoted listing is accepted with its business name', async () => {
  const item = await spotlight.createRequest('food', kitchen, {
    kind: 'listing', title: 'Top of the list', startDate: iso(-day), endDate: iso(5 * day), budgetNote: 'Rs 2000 / week',
  });
  listingId = item.id;
  assert.equal(item.partnerName, 'Dev Kitchen');
  assert.equal(item.state, 'pending');
});
await check('bad requests are refused', async () => {
  await rejects(() => spotlight.createRequest('food', kitchen, { kind: 'popup', title: 'x', startDate: iso(0), endDate: iso(day) }), 400);
  await rejects(() => spotlight.createRequest('food', kitchen, { kind: 'listing', title: ' ', startDate: iso(0), endDate: iso(day) }), 400);
  await rejects(() => spotlight.createRequest('food', kitchen, { kind: 'listing', title: 'x', startDate: iso(day), endDate: iso(0) }), 400);
  await rejects(() => spotlight.createRequest('food', kitchen, { kind: 'banner', title: 'x', startDate: iso(0), endDate: iso(day) }), 400);
  await rejects(() => spotlight.createRequest('food', kitchen, {
    kind: 'listing', title: 'x', startDate: iso(0), endDate: iso(day), ctaLink: 'javascript:alert(1)',
  }), 400);
});
await check('an unknown business cannot ask', async () => {
  await rejects(() => spotlight.createRequest('food', oid(), { kind: 'listing', title: 'x', startDate: iso(0), endDate: iso(day) }), 403);
  // A seller's id is not a restaurant.
  await rejects(() => spotlight.createRequest('food', seller, { kind: 'listing', title: 'x', startDate: iso(0), endDate: iso(day) }), 403);
});
await check('undecided requests are capped per partner', async () => {
  for (let i = 0; i < 9; i += 1) {
    await spotlight.createRequest('food', other, { kind: 'listing', title: `n${i}`, startDate: iso(0), endDate: iso(day) });
  }
  await spotlight.createRequest('food', other, { kind: 'listing', title: 'tenth', startDate: iso(0), endDate: iso(day) });
  await rejects(() => spotlight.createRequest('food', other, { kind: 'listing', title: 'eleventh', startDate: iso(0), endDate: iso(day) }), 429);
});
await check('a partner withdraws only their own undecided request', async () => {
  const theirs = (await spotlight.listOwn('food', other))[0];
  await rejects(() => spotlight.withdrawOwn('food', kitchen, theirs.id), 404);
  await spotlight.withdrawOwn('food', other, theirs.id);
  assert.equal((await spotlight.listOwn('food', other)).length, 9);
});

console.log('\nReviewing');
await check('the review queue lists pending requests for that service only', async () => {
  const { items } = await spotlight.adminList(owner, { service: 'food', view: 'requests' });
  assert.equal(items.length, 10);
  assert.equal((await spotlight.adminList(owner, { service: 'shop', view: 'requests' })).items.length, 0);
});
await check('a view-only admin sees but cannot decide; another service is closed', async () => {
  assert.equal((await spotlight.adminList(foodPromoReader, { service: 'food', view: 'requests' })).items.length, 10);
  await rejects(() => spotlight.adminReview(foodPromoReader, listingId, { decision: 'approve' }), 403);
  await rejects(() => spotlight.adminList(foodPromoReader, { service: 'shop' }), 403);
});
await check('rejecting needs a reason the partner then sees', async () => {
  const one = (await spotlight.listOwn('food', other))[0];
  await rejects(() => spotlight.adminReview(owner, one.id, { decision: 'reject' }), 400);
  await spotlight.adminReview(owner, one.id, { decision: 'reject', reason: 'Image too blurry' });
  const mine = (await spotlight.listOwn('food', other)).find((i) => i.id === one.id);
  assert.equal(mine.state, 'rejected');
  assert.equal(mine.rejectionReason, 'Image too blurry');
  await rejects(() => spotlight.adminReview(owner, one.id, { decision: 'approve' }), 409);
});
await check('approving makes a listing run, and it is served as promoted', async () => {
  const item = await spotlight.adminReview(owner, listingId, { decision: 'approve' });
  assert.equal(item.state, 'running');
  const { status, text } = await call('/platform/spotlight/promoted?service=food');
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(text).data.items.map((i) => i.partnerId), [String(kitchen)]);
});
await check('pause, resume and edit; states follow the dates', async () => {
  assert.equal((await spotlight.adminUpdate(owner, listingId, { paused: true })).state, 'paused');
  assert.equal(JSON.parse((await call('/platform/spotlight/promoted?service=food')).text).data.items.length, 0);
  assert.equal((await spotlight.adminUpdate(owner, listingId, { paused: false })).state, 'running');
  assert.equal((await spotlight.adminUpdate(owner, listingId, { startDate: iso(day) })).state, 'scheduled');
  assert.equal((await spotlight.adminUpdate(owner, listingId, { startDate: iso(-3 * day), endDate: iso(-day) })).state, 'expired');
  const edited = await spotlight.adminUpdate(owner, listingId, { title: 'Renamed', endDate: iso(day) });
  assert.equal(edited.title, 'Renamed');
  assert.equal(edited.state, 'running');
  const { items } = await spotlight.adminList(owner, { service: 'food', state: 'running' });
  assert.deepEqual(items.map((i) => i.id), [listingId]);
});

console.log('\nBanners customers see');
await check('a running banner ad joins the service\'s home promotion strip; paused leaves it', async () => {
  await db.collection('food_home_promotion_banners').insertOne({ _id: oid(), imageUrl: 'https://x/own.jpg', title: 'Own', isActive: true });
  const ad = await SpotlightAd.create({
    service: 'food', partnerId: kitchen, partnerName: 'Dev Kitchen', kind: 'banner', title: 'Dosa week',
    imageUrl: 'https://x/ad.jpg', startDate: new Date(Date.now() - day), endDate: new Date(Date.now() + day), status: 'approved',
  });
  // A Shop ad must not leak into Food.
  await SpotlightAd.create({
    service: 'shop', partnerId: seller, kind: 'banner', title: 'Shop sale',
    imageUrl: 'https://x/shop.jpg', startDate: new Date(Date.now() - day), endDate: new Date(Date.now() + day), status: 'approved',
  });
  const read = async () => JSON.parse((await call('/food/hero-banners/home-promotion/public')).text).data.banners.map((b) => b.title);
  assert.deepEqual(await read(), ['Own', 'Dosa week']);
  await spotlight.adminUpdate(owner, String(ad._id), { paused: true });
  assert.deepEqual(await read(), ['Own']);
});

console.log('\nAdmin-made ads');
await check('an admin makes an ad for a business: approved at once, marked as admin-made', async () => {
  const item = await spotlight.adminCreate(owner, {
    service: 'shop', kind: 'listing', partnerId: String(seller), title: 'Festive pick', startDate: iso(-day), endDate: iso(day),
  });
  assert.equal(item.state, 'running');
  assert.equal(item.partnerName, 'Dev Crafts');
  assert.equal((await SpotlightAd.findById(item.id).lean()).createdByAdmin, true);
});
await check('admin-made ads are checked too, and need write access', async () => {
  const base = { service: 'shop', title: 'x', startDate: iso(0), endDate: iso(day) };
  await rejects(() => spotlight.adminCreate(owner, { ...base, kind: 'listing' }), 400); // no business
  await rejects(() => spotlight.adminCreate(owner, { ...base, kind: 'listing', partnerId: String(kitchen) }), 400); // Food's
  await rejects(() => spotlight.adminCreate(owner, { ...base, kind: 'banner' }), 400); // no image
  await rejects(() => spotlight.adminCreate(foodPromoReader, { ...base, service: 'food', kind: 'listing', partnerId: String(kitchen) }), 403);
});
await check('the business picker searches one service by name', async () => {
  const { items } = await spotlight.searchPartners(owner, { service: 'food', q: 'dev' });
  assert.deepEqual(items.map((i) => i.name), ['Dev Kitchen']);
});

console.log('\nPromoted listings in customer lists');
await check('running listings go first, marked, at most two, no duplicates; expired and paused are not boosted', async () => {
  const ids = Array.from({ length: 6 }, () => oid());
  const ad = (partnerId, startOffset, endOffset, status = 'approved') => ({
    service: 'quick', partnerId, kind: 'listing', title: 't', status,
    startDate: new Date(Date.now() + startOffset), endDate: new Date(Date.now() + endOffset),
  });
  await SpotlightAd.insertMany([
    ad(ids[4], -3 * day, day), // earliest-started running: first
    ad(ids[2], -2 * day, day),
    ad(ids[2], -day, day), // a second ad for the same store: still once
    ad(ids[5], -day / 2, day), // third running: over the cap
    ad(ids[1], -3 * day, -day), // expired
    ad(ids[3], -day, day, 'paused'),
    ad(oid(), -day, day), // a store not in this list (another zone): not added
  ]);
  const list = ids.map((id, n) => ({ _id: id, name: `s${n}` }));
  const out = await spotlight.boostPromoted('quick', list);
  assert.deepEqual(out.map((r) => r.name), ['s4', 's2', 's0', 's1', 's3', 's5']);
  assert.deepEqual(out.map((r) => r.isPromoted === true), [true, true, false, false, false, false]);
  // Another service's ads do not apply.
  assert.deepEqual((await spotlight.boostPromoted('shop', list)).map((r) => r.name), list.map((r) => r.name));
});

console.log('\nThe mail list');
await check('subscribing is validated', async () => {
  const bad = await call('/platform/mailing-list/subscribe', { email: 'not-an-email', source: 'food' });
  assert.equal(bad.status, 400);
});
await check('subscribing twice is one row with both sources, same answer', async () => {
  const a = await call('/platform/mailing-list/subscribe', { email: ' Om@Example.com ', source: 'food' });
  const b = await call('/platform/mailing-list/subscribe', { email: 'om@example.com', source: 'shop' });
  assert.equal(a.status, 200);
  assert.equal(a.text, b.text);
  const rows = await MailSubscriber.find({}).lean();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sources.sort(), ['food', 'shop']);
});
await check('the unsubscribe link works, and subscribing again restores', async () => {
  const { unsubscribeToken } = await MailSubscriber.findOne({ email: 'om@example.com' }).lean();
  const page = await call(`/platform/mailing-list/unsubscribe?token=${unsubscribeToken}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /unsubscribed/i);
  assert.equal((await MailSubscriber.findOne({ email: 'om@example.com' }).lean()).status, 'unsubscribed');
  // An unknown token reads the same, and changes nothing.
  assert.equal((await call(`/platform/mailing-list/unsubscribe?token=${'a'.repeat(48)}`)).status, 200);
  await mail.subscribe({ email: 'om@example.com', source: 'food' });
  assert.equal((await MailSubscriber.findOne({ email: 'om@example.com' }).lean()).status, 'subscribed');
});
await check('admin list: search, source, dates; CSV neutralises formulas', async () => {
  await MailSubscriber.create({ email: '=cmd@evil.com', sources: ['shop'], unsubscribeToken: 'b'.repeat(48), subscribedAt: new Date('2026-01-05') });
  assert.equal((await mail.adminList(owner, {})).total, 2);
  assert.deepEqual((await mail.adminList(owner, { source: 'shop' })).items.map((i) => i.email).sort(), ['=cmd@evil.com', 'om@example.com']);
  assert.deepEqual((await mail.adminList(owner, { q: 'OM@' })).items.map((i) => i.email), ['om@example.com']);
  assert.deepEqual((await mail.adminList(owner, { from: '2026-01-01', to: '2026-01-05' })).items.map((i) => i.email), ['=cmd@evil.com']);
  const csv = await mail.adminExportCsv(owner, { source: 'shop' });
  assert.match(csv, /^Email,Sources/);
  assert.match(csv, /\n'=cmd@evil\.com,/);
});
await check('the admin list needs Customers access for that service', async () => {
  const foodCustomers = sub(['food'], ['customers.read']);
  assert.equal((await mail.adminList(foodCustomers, { source: 'food' })).total, 1);
  await rejects(() => mail.adminList(foodCustomers, { source: 'shop' }), 403);
  await rejects(() => mail.adminList(foodCustomers, {}), 403);
  await rejects(() => mail.adminList(foodPromoReader, { source: 'food' }), 403);
});
console.log('\nSending the newsletter');
const campaigns = await import('../src/core/mailingList/mailCampaign.service.js');
await check('sends to every active subscriber, each with their own unsubscribe link; never to the unsubscribed', async () => {
  for (let i = 0; i < 120; i += 1) await mail.subscribe({ email: `bulk${i}@example.com`, source: 'shop' });
  await mail.subscribe({ email: 'gone@example.com', source: 'shop' });
  const gone = await MailSubscriber.findOne({ email: 'gone@example.com' }).lean();
  await mail.unsubscribe(gone.unsubscribeToken);
  const outbox = [];
  const send = async (m) => { outbox.push(m); return !m.to.startsWith('bulk7@'); }; // one bounce
  const c = await campaigns.startCampaign(owner, { subject: 'Diwali offers', body: 'Hello <friends>\nBig sale', source: 'shop' }, { wait: true, send });
  const to = outbox.map((m) => m.to);
  assert.equal(new Set(to).size, to.length, 'nobody mailed twice');
  assert.ok(!to.includes('gone@example.com'));
  assert.equal(c.total, to.length);
  assert.equal(c.sent, to.length - 1);
  assert.equal(c.failed, 1);
  assert.equal(c.status, 'sent');
  const om = outbox.find((m) => m.to === 'om@example.com');
  const { unsubscribeToken } = await MailSubscriber.findOne({ email: 'om@example.com' }).lean();
  assert.ok(om.text.includes(`token=${unsubscribeToken}`));
  assert.ok(om.html.includes('Hello &lt;friends&gt;<br>Big sale'));
  assert.match(om.headers['List-Unsubscribe'], /unsubscribe\?token=/);
});
await check('a source filter only reaches that source', async () => {
  const outbox = [];
  await campaigns.startCampaign(owner, { subject: 's', body: 'b', source: 'food' }, { wait: true, send: async (m) => { outbox.push(m.to); return true; } });
  assert.deepEqual(outbox, ['om@example.com']);
});
await check('sending is checked and needs Banners & pages write access', async () => {
  const send = async () => true;
  await rejects(() => campaigns.startCampaign(owner, { subject: '', body: 'b' }, { send }), 400);
  await rejects(() => campaigns.startCampaign(owner, { subject: 's', body: 'b', source: 'taxi' }, { send }), 400); // nobody
  await rejects(() => campaigns.startCampaign(sub(['food'], ['customers.write']), { subject: 's', body: 'b', source: 'food' }, { send }), 403);
  const { items } = await campaigns.listCampaigns(owner);
  assert.equal(items.length, 2);
  assert.equal(items[0].body, undefined);
});

await check('the admin endpoints are closed without an admin session', async () => {
  assert.equal((await call('/platform/mailing-list')).status, 401);
  assert.equal((await call('/platform/spotlight?service=food')).status, 401);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
