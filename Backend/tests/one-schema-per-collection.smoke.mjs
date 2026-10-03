/**
 * Every collection is described by one schema.
 *
 * Run: node tests/one-schema-per-collection.smoke.mjs
 *
 * Loads every model file, groups the models by the collection they actually
 * write to, and fails if two models over one collection declare different
 * fields or types. Models may still differ in options (a vertical's default,
 * whether the password is hidden) -- that is how Quick's payment models and
 * taxi's admin model are built -- but not in what a document is.
 *
 * Then the bugs the second schemas caused, against an in-memory MongoDB:
 *   - Services could not save an admin that Master or taxi made (role enum);
 *   - taxi switched admins off with `active`, which no other panel read;
 *   - taxi's admin delete left the customer signed in everywhere else;
 *   - taxi's user writes skipped the platform's phoneLast10 hook;
 * and reconcileAccountFlags fixes rows written before.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(48).toString('hex');

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

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// --- the rule, over every model ----------------------------------------------
console.log('\none schema per collection');

const files = execSync('git ls-files src', { cwd: backend, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(models?\/|\.model\.)/.test(f) && /\.(c?js|mjs)$/.test(f) && !f.includes('__checks__'));
const loadErrors = [];
for (const f of files) {
    try {
        await import(pathToFileURL(path.join(backend, f)).href);
    } catch (err) {
        loadErrors.push(`${f}: ${err.message.split('\n')[0]}`);
    }
}

await check('every model file loads', () => {
    assert.deepEqual(loadErrors, []);
});

/** path -> instance type, the shape of a document as a schema sees it. */
const shape = (schema) => Object.fromEntries(
    Object.entries(schema.paths).map(([p, t]) => [p, t.instance]).sort(([a], [b]) => a.localeCompare(b)),
);

const byCollection = new Map();
for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    const c = model.collection.collectionName;
    if (!byCollection.has(c)) byCollection.set(c, []);
    byCollection.get(c).push(model);
}

await check('models sharing a collection declare the same fields and types', () => {
    const conflicts = [];
    for (const [c, models] of byCollection) {
        const [first, ...rest] = models;
        const base = shape(first.schema);
        for (const m of rest) {
            const other = shape(m.schema);
            const keys = new Set([...Object.keys(base), ...Object.keys(other)]);
            const diff = [...keys].filter((k) => base[k] !== other[k]);
            if (diff.length) conflicts.push(`${c}: ${first.modelName} vs ${m.modelName} differ on ${diff.join(', ')}`);
        }
    }
    assert.deepEqual(conflicts, []);
});

await check('users and admins are each read by more than one model (so the rule above is exercised)', () => {
    assert.ok(byCollection.get('users').length >= 2);
    assert.ok(byCollection.get('admins').length >= 3);
});

// --- the bugs, against a database --------------------------------------------
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri('one_schema'));

const { FoodAdmin, isAdminActive } = await import('../src/core/admin/admin.model.js');
const { Admin: TaxiAdmin } = await import('../src/modules/taxi/admin/models/Admin.js');
const SPAdmin = require('../src/modules/serviceProvider/models/Admin.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const { User: TaxiUser } = await import('../src/modules/taxi/user/models/User.js');
const { decideAdminAccess } = await import('../src/core/admin/adminAccessPolicy.js');
const { reconcileAccountFlags } = await import('../scripts/migrations/reconcileAccountFlags.mjs');

await Promise.all([FoodAdmin.init(), FoodUser.init()]);

console.log('\nadmins');

await check('Services can save an admin that Master made (role ADMIN) and one taxi made (superadmin)', async () => {
    const master = await FoodAdmin.create({ email: 'master@x.in', password: 'secret1', role: 'ADMIN', servicesAccess: ['serviceProvider'] });
    const taxi = await TaxiAdmin.create({ name: 'T', email: 'taxi@x.in', password: await bcrypt.hash('secret1', 4) });
    for (const id of [master._id, taxi._id]) {
        const doc = await SPAdmin.findById(id).select('+password');
        doc.lastLogin = new Date();
        await doc.save();
    }
});

await check('taxi does not hash a password it already hashed; Food and Services do hash', async () => {
    const hashed = await bcrypt.hash('secret1', 4);
    const taxi = await TaxiAdmin.create({ name: 'T', email: 'hash-taxi@x.in', password: hashed });
    assert.equal((await TaxiAdmin.findById(taxi._id).select('+password').lean()).password, hashed);

    const food = await FoodAdmin.create({ email: 'hash-food@x.in', password: 'plain12' });
    assert.ok(await bcrypt.compare('plain12', (await FoodAdmin.findById(food._id).lean()).password));

    const sp = await SPAdmin.create({ name: 'S', email: 'hash-sp@x.in', password: 'plain12' });
    assert.ok(await bcrypt.compare('plain12', (await SPAdmin.findById(sp._id).select('+password').lean()).password));
});

await check('taxi and Services still hide the password; Food still reads it', async () => {
    const doc = await FoodAdmin.create({ email: 'hidden@x.in', password: 'plain12' });
    assert.equal((await TaxiAdmin.findById(doc._id).lean()).password, undefined);
    assert.equal((await SPAdmin.findById(doc._id).lean()).password, undefined);
    assert.ok((await FoodAdmin.findById(doc._id).lean()).password);
});

await check('taxi switching an admin off switches it off for every panel', async () => {
    const doc = await FoodAdmin.create({ email: 'off-taxi@x.in', password: 'plain12', admin_type: 'superadmin' });
    const asTaxi = await TaxiAdmin.findById(doc._id);
    asTaxi.active = false;
    asTaxi.status = 'inactive';
    await asTaxi.save();
    const row = await FoodAdmin.findById(doc._id).lean();
    assert.equal(row.isActive, false);
    assert.equal(decideAdminAccess(row, { service: 'food', resource: 'orders', write: false }).allowed, false);
});

await check('Master switching an admin off switches taxi\'s spellings off too, and back on', async () => {
    const doc = await FoodAdmin.create({ email: 'off-master@x.in', password: 'plain12' });
    doc.isActive = false;
    await doc.save();
    let row = await TaxiAdmin.findById(doc._id).lean();
    assert.equal(row.active, false);
    assert.equal(row.status, 'inactive');
    doc.isActive = true;
    await doc.save();
    row = await TaxiAdmin.findById(doc._id).lean();
    assert.equal(row.active, true);
    assert.equal(row.status, 'active');
});

await check('an old row off only in taxi\'s spelling is refused everywhere before any migration', () => {
    const legacy = { _id: new mongoose.Types.ObjectId(), isActive: true, active: false, status: 'inactive', admin_type: 'superadmin' };
    assert.equal(isAdminActive(legacy), false);
    assert.equal(decideAdminAccess(legacy, { service: 'food', resource: 'orders', write: false }).allowed, false);
    assert.equal(isAdminActive({ isActive: true }), true);
});

console.log('\nusers');

await check('taxi\'s password is hidden from every user model', async () => {
    const u = await TaxiUser.create({ phone: '9000000001', password: await bcrypt.hash('secret1', 4) });
    assert.equal((await FoodUser.findById(u._id).lean()).password, undefined);
    assert.equal((await TaxiUser.findById(u._id).lean()).password, undefined);
    assert.ok((await TaxiUser.findById(u._id).select('+password').lean()).password);
});

await check('a number taxi writes or changes is stamped in phoneLast10', async () => {
    const u = await TaxiUser.create({ phone: '+91 90000 00002' });
    assert.equal((await FoodUser.findById(u._id).lean()).phoneLast10, '9000000002');
    await TaxiUser.findByIdAndUpdate(u._id, { $set: { phone: '9000000003' } });
    assert.equal((await FoodUser.findById(u._id).lean()).phoneLast10, '9000000003');
});

await check('taxi\'s admin delete signs the customer out of every app; restore brings them back', async () => {
    const taxiAdmin = await import('../src/modules/taxi/admin/services/adminService.js');
    const u = await FoodUser.create({ phone: '9000000004' });
    await taxiAdmin.deleteUser(u._id);
    let row = await FoodUser.findById(u._id).lean();
    assert.ok(row.deletedAt);
    assert.equal(row.isActive, false);
    await taxiAdmin.restoreDeletedUser(u._id);
    row = await FoodUser.findById(u._id).lean();
    assert.equal(row.deletedAt, null);
    assert.equal(row.isActive, true);
});

console.log('\nreconcileAccountFlags');

await check('dry run counts and writes nothing; --apply fixes; a second run finds nothing', async () => {
    const db = mongoose.connection;
    await db.collection('admins').deleteMany({});
    await db.collection('users').deleteMany({});
    const [a1, a2] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await db.collection('admins').insertMany([
        { _id: a1, email: 'legacy-off@x.in', isActive: true, active: false, status: 'inactive' },
        { _id: a2, email: 'legacy-on@x.in', isActive: true, active: true, status: 'active' },
    ]);
    const u1 = new mongoose.Types.ObjectId();
    await db.collection('users').insertMany([
        { _id: u1, phone: '9000000005', isActive: true, deletedAt: new Date() },
        { phone: '9000000006', isActive: true, deletedAt: null, active: false },
    ]);
    const quiet = () => {};

    assert.deepEqual(await reconcileAccountFlags({ log: quiet }), { admins: 1, users: 1 });
    assert.equal((await db.collection('admins').findOne({ _id: a1 })).isActive, true);

    assert.deepEqual(await reconcileAccountFlags({ apply: true, log: quiet }), { admins: 1, users: 1 });
    const off = await db.collection('admins').findOne({ _id: a1 });
    assert.deepEqual([off.isActive, off.active, off.status], [false, false, 'inactive']);
    assert.equal((await db.collection('admins').findOne({ _id: a2 })).isActive, true);
    assert.equal((await db.collection('users').findOne({ _id: u1 })).isActive, false);
    // taxi's own block is not a platform block
    assert.equal((await db.collection('users').findOne({ phone: '9000000006' })).isActive, true);

    assert.deepEqual(await reconcileAccountFlags({ apply: true, log: quiet }), { admins: 0, users: 0 });
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
