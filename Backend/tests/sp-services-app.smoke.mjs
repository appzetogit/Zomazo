/**
 * The customer Services app's backend: appointment slots, saved services,
 * professional profiles and entering a friend's referral code.
 *
 * Run: node tests/sp-services-app.smoke.mjs
 *
 * What this guards:
 *   - a booking or reschedule for a time already gone, outside the hours visits
 *     run, too soon to reach, or past the booking window is refused; the rules
 *     come from settings and are served on /public/config for the app;
 *   - a customer saves, lists and removes services; a switched-off service is
 *     not listed; nothing without a login;
 *   - a professional's public profile shows ratings, reviews and services, and
 *     nothing private; pending or blocked accounts have none;
 *   - a customer new to Services can enter a friend's code once, never their own,
 *     and not after booking.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
process.env.JWT_SECRET ||= 'sp-services-app-smoke-secret-that-is-long-enough-for-hs256-0123456789abcdef';

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

const IST = 330 * 60000;
const DAY = 86400000;
/** Noon IST on the IST calendar day `days` from today, as the app sends it. */
const istNoon = (days, now = Date.now()) => {
    const shifted = new Date(now + IST);
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + days, 12) - IST).toISOString();
};

const main = async () => {
    const SP = '../src/modules/serviceProvider';
    const slots = require(`${SP}/utils/bookingSlots.js`);

    console.log('\n[1] slot rules');

    const rules = slots.slotRules(null);
    // 10:00 IST on 2026-03-10 is 04:30Z.
    const at = (iso) => new Date(iso).getTime();
    const now = at('2026-03-10T04:30:00Z');

    await check('defaults: 8 AM to 8 PM, two-hour slots, an hour of notice, a week ahead, IST', async () => {
        assert.deepEqual(rules, { startHour: 8, endHour: 20, slotHours: 2, leadMinutes: 60, advanceDays: 7, timezoneOffsetMinutes: 330 });
    });

    await check('a slot later today with enough notice, or any day this week, is accepted', async () => {
        assert.equal(slots.slotProblem({ scheduledDate: '2026-03-10T06:30:00Z', timeSlot: { start: '12:00', end: '14:00' }, rules, now }), null);
        assert.equal(slots.slotProblem({ scheduledDate: '2026-03-16T06:30:00Z', timeSlot: { start: '08:00', end: '10:00' }, rules, now }), null);
        assert.equal(slots.slotProblem({ scheduledDate: '2026-03-11T06:30:00Z', timeSlot: { start: '6:00 PM', end: '8:00 PM' }, rules, now }), null);
    });

    await check('a slot already gone, or too soon, is refused', async () => {
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-10T06:30:00Z', timeSlot: { start: '08:00', end: '10:00' }, rules, now }), /passed/);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-09T06:30:00Z', timeSlot: { start: '14:00', end: '16:00' }, rules, now }), /passed/);
        const quarterPastTen = at('2026-03-10T04:45:00Z');
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-10T06:30:00Z', timeSlot: { start: '10:00', end: '12:00' }, rules, now: quarterPastTen }), /passed/);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-10T06:30:00Z', timeSlot: { start: '11:00', end: '13:00' }, rules, now: quarterPastTen }), /notice/);
    });

    await check('outside the hours, past the window, or nonsense is refused', async () => {
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-11T06:30:00Z', timeSlot: { start: '03:00', end: '05:00' }, rules, now }), /between 8 AM and 8 PM/);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-11T06:30:00Z', timeSlot: { start: '19:00', end: '21:00' }, rules, now }), /between/);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-17T06:30:00Z', timeSlot: { start: '10:00', end: '12:00' }, rules, now }), /7 days ahead/);
        assert.match(slots.slotProblem({ scheduledDate: 'not a date', timeSlot: { start: '10:00' }, rules, now }), /valid date/);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-11T06:30:00Z', timeSlot: { start: 'soon' }, rules, now }), /valid time/);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-11T06:30:00Z', timeSlot: { start: '12:00', end: '10:00' }, rules, now }), /valid time/);
    });

    await check('the calendar day is the business one, whatever instant on it is sent', async () => {
        // 23:00 IST on the 10th is 17:30Z; still the 10th for the business.
        assert.equal(slots.slotProblem({ scheduledDate: '2026-03-10T17:30:00Z', timeSlot: { start: '14:00', end: '16:00' }, rules, now }), null);
        // 00:30 IST on the 11th is 19:00Z on the 10th.
        assert.equal(slots.slotProblem({ scheduledDate: '2026-03-10T19:00:00Z', timeSlot: { start: '08:00', end: '10:00' }, rules, now }), null);
    });

    await check('an instant booking is only held to its day', async () => {
        assert.equal(slots.slotProblem({ scheduledDate: '2026-03-10T04:30:00Z', timeSlot: { start: '10:00' }, rules, now, instant: true }), null);
        assert.match(slots.slotProblem({ scheduledDate: '2026-03-08T04:30:00Z', timeSlot: { start: '10:00' }, rules, now, instant: true }), /passed/);
    });

    await check('settings out of range are pulled back into range', async () => {
        const r = slots.slotRules({ slotStartHour: 22, slotEndHour: 6, slotLengthHours: 50, bookingWindowDays: 0 });
        assert.ok(r.endHour > r.startHour);
        assert.ok(r.slotHours <= r.endHour - r.startHour);
        assert.equal(r.advanceDays, 1);
    });

    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_services_app' });

    const Booking = require(`${SP}/models/Booking.js`);
    const User = require(`${SP}/models/User.js`);
    const Worker = require(`${SP}/models/Worker.js`);
    const Vendor = require(`${SP}/models/Vendor.js`);
    const Service = require(`${SP}/models/UserService.js`);
    const Category = require(`${SP}/models/Category.js`);
    const Brand = require(`${SP}/models/Brand.js`);
    const Review = require(`${SP}/models/Review.js`);
    const Settings = require(`${SP}/models/Settings.js`);
    const Admin = require(`${SP}/models/Admin.js`);
    for (const M of [Booking, User, Worker, Vendor, Service, Category, Brand, Review, Settings]) {
        await M.createCollection().catch(() => {});
    }
    await Promise.all([User.init(), Worker.init()]).catch(() => {});

    const fcm = require(`${SP}/services/firebaseAdmin.js`);
    fcm.sendPushNotification = async (tokens) => ({ successCount: tokens.length, failureCount: 0 });

    const { generateAccessToken } = require(`${SP}/utils/tokenService.js`);
    const spRouter = require(`${SP}/routes/index.js`);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/sp', spRouter);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1/sp`;
    const call = async (method, path, body, token) => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty */ }
        return { status: res.status, json };
    };

    const admin = await Admin.create({
        name: 'Ops', email: 'ops@svc.test', password: 'Passw0rd!', role: 'super_admin',
        admin_type: 'superadmin', adminLevel: 'sp_superadmin', permissions: ['*'],
        servicesAccess: ['serviceProvider'], isActive: true,
    });
    const adminToken = generateAccessToken({ userId: String(admin._id), role: 'admin' });

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9700000000;
    const newUser = async (extra = {}) => {
        const _id = oid();
        await User.collection.insertOne({ _id, name: 'Asha Rao', email: `s${seq}@t.test`, phone: String(seq++), wallet: { balance: 0, penalty: 0 }, isActive: true, referredBy: null, ...extra });
        return { id: _id, token: generateAccessToken({ userId: String(_id), role: 'USER' }) };
    };

    const category = await Category.create({ title: 'Plumbing', slug: 'plumbing' });
    const brand = await Brand.create({ title: 'Taps and pipes', slug: 'taps-and-pipes', categoryIds: [category._id], categoryId: category._id });
    const tap = await Service.create({ title: 'Tap repair', brandId: brand._id, categoryId: category._id, basePrice: 300, gstPercentage: 18 });
    const leak = await Service.create({ title: 'Leak fix', brandId: brand._id, basePrice: 500, gstPercentage: 18 });
    const retired = await Service.create({ title: 'Old thing', brandId: brand._id, categoryId: category._id, basePrice: 100, gstPercentage: 18, status: 'inactive' });

    const address = { addressLine1: '1 St', city: 'Pune', state: 'MH', pincode: '411001', lat: 18.52, lng: 73.85 };
    const bookingBody = (scheduledDate, start, end) => ({
        serviceId: String(tap._id), address, scheduledDate, scheduledTime: `${start} - ${end}`,
        timeSlot: { start, end }, paymentMethod: 'pay_at_home', bookingType: 'scheduled',
    });

    console.log('\n[2] slots on the booking endpoints');

    const booker = await newUser();

    await check('/public/config serves the slot rules', async () => {
        const r = await call('GET', '/public/config');
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.deepEqual(r.json.settings.bookingSlots, rules);
    });

    await check('a booking for yesterday, or at 3 AM, is refused; tomorrow at 10 is taken', async () => {
        const past = await call('POST', '/users/bookings', bookingBody(istNoon(-1), '10:00', '12:00'), booker.token);
        assert.equal(past.status, 400, JSON.stringify(past.json));
        assert.equal(past.json.code, 'SLOT_UNAVAILABLE');
        const night = await call('POST', '/users/bookings', bookingBody(istNoon(1), '03:00', '05:00'), booker.token);
        assert.equal(night.status, 400);
        assert.equal(await Booking.countDocuments({ userId: booker.id }), 0);
        const ok = await call('POST', '/users/bookings', bookingBody(istNoon(1), '10:00', '12:00'), booker.token);
        assert.equal(ok.status, 201, JSON.stringify(ok.json));
    });

    await check('a reschedule into the past is refused; once on the way, none at all', async () => {
        const booking = await Booking.findOne({ userId: booker.id });
        const back = await call('PUT', `/users/bookings/${booking._id}/reschedule`, { scheduledDate: istNoon(-2), scheduledTime: 'x', timeSlot: { start: '10:00', end: '12:00' } }, booker.token);
        assert.equal(back.status, 400, JSON.stringify(back.json));
        const fine = await call('PUT', `/users/bookings/${booking._id}/reschedule`, { scheduledDate: istNoon(2), scheduledTime: 'x', timeSlot: { start: '14:00', end: '16:00' } }, booker.token);
        assert.equal(fine.status, 200, JSON.stringify(fine.json));
        await Booking.updateOne({ _id: booking._id }, { $set: { status: 'journey_started' } });
        const late = await call('PUT', `/users/bookings/${booking._id}/reschedule`, { scheduledDate: istNoon(3), scheduledTime: 'x', timeSlot: { start: '14:00', end: '16:00' } }, booker.token);
        assert.equal(late.status, 400);
        assert.match(late.json.message, /on the way/);
    });

    await check('an admin sets the hours; the booking endpoint follows them', async () => {
        const bad = await call('PUT', '/admin/settings', { slotStartHour: 18, slotEndHour: 10 }, adminToken);
        assert.equal(bad.status, 400, JSON.stringify(bad.json));
        const set = await call('PUT', '/admin/settings', { slotStartHour: 10, slotEndHour: 14, slotLengthHours: 1 }, adminToken);
        assert.equal(set.status, 200, JSON.stringify(set.json));
        const cfg = await call('GET', '/public/config');
        assert.equal(cfg.json.settings.bookingSlots.startHour, 10);
        assert.equal(cfg.json.settings.bookingSlots.slotHours, 1);
        const early = await call('POST', '/users/bookings', bookingBody(istNoon(1), '08:00', '09:00'), booker.token);
        assert.equal(early.status, 400);
        assert.match(early.json.message, /between 10 AM and 2 PM/);
        await Settings.updateOne({ type: 'global' }, { $set: { slotStartHour: 8, slotEndHour: 20, slotLengthHours: 2 } });
    });

    console.log('\n[3] saved services');

    const saver = await newUser();

    await check('save, list (newest first), and remove a service', async () => {
        assert.equal((await call('PUT', `/users/favourites/${tap._id}`, null, saver.token)).status, 200);
        const second = await call('PUT', `/users/favourites/${leak._id}`, null, saver.token);
        assert.deepEqual(second.json.ids, [String(tap._id), String(leak._id)]);
        assert.equal((await call('PUT', `/users/favourites/${leak._id}`, null, saver.token)).json.ids.length, 2, 'saving twice keeps one');
        const list = await call('GET', '/users/favourites', null, saver.token);
        assert.equal(list.status, 200);
        assert.deepEqual(list.json.data.map((s) => s.title), ['Leak fix', 'Tap repair']);
        assert.equal(list.json.data[0].brandName, 'Taps and pipes');
        const removed = await call('DELETE', `/users/favourites/${tap._id}`, null, saver.token);
        assert.deepEqual(removed.json.ids, [String(leak._id)]);
    });

    await check('a switched-off or unknown service cannot be saved, and is not listed', async () => {
        assert.equal((await call('PUT', `/users/favourites/${retired._id}`, null, saver.token)).status, 404);
        assert.equal((await call('PUT', '/users/favourites/nope', null, saver.token)).status, 404);
        await User.updateOne({ _id: saver.id }, { $addToSet: { favouriteServices: retired._id } });
        const list = await call('GET', '/users/favourites', null, saver.token);
        assert.deepEqual(list.json.data.map((s) => s.title), ['Leak fix']);
    });

    await check('no login, no favourites', async () => {
        assert.equal((await call('GET', '/users/favourites')).status, 401);
        assert.equal((await call('PUT', `/users/favourites/${tap._id}`)).status, 401);
    });

    console.log('\n[4] professional profiles');

    const pro = await Worker.create({
        name: 'Ravi Kumar', email: 'ravi@w.test', phone: '9600000001', approvalStatus: 'approved', isActive: true,
        serviceCategories: ['Plumbing'], rating: 4.2, completedJobs: 31, address: { city: 'Pune', addressLine1: 'secret lane' },
    });
    const pending = await Worker.create({ name: 'New Joiner', email: 'nj@w.test', phone: '9600000002', approvalStatus: 'pending', serviceCategories: ['Plumbing'] });
    const reviewer = await newUser({ name: 'Meera Shah' });
    for (const [n, rating, status] of [[1, 5, 'active'], [2, 4, 'active'], [3, 1, 'hidden']]) {
        await Review.create({ bookingId: oid(), userId: reviewer.id, serviceId: tap._id, workerId: pro._id, rating, review: `review ${n}`, status });
    }

    await check('a profile has the rating, reviews and services, and nothing private', async () => {
        const r = await call('GET', `/public/providers/${pro._id}`);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.provider.name, 'Ravi Kumar');
        assert.equal(r.json.provider.kind, 'worker');
        assert.equal(r.json.provider.completedJobs, 31);
        assert.ok(r.json.provider.memberSince);
        assert.deepEqual(r.json.provider.categories.map((c) => c.title), ['Plumbing']);
        assert.equal(r.json.rating.total, 2, 'hidden reviews are left out');
        assert.equal(r.json.rating.average, 4.5);
        assert.equal(r.json.reviews[0].author, 'Meera', 'reviewers by first name');
        assert.equal(r.json.reviews[0].service, 'Tap repair');
        assert.deepEqual(r.json.services.map((s) => s.title).sort(), ['Leak fix', 'Tap repair'], 'by category or by brand, active only');
        const text = JSON.stringify(r.json);
        for (const secret of ['9600000001', 'ravi@w.test', 'secret lane']) assert.ok(!text.includes(secret), `leaks ${secret}`);
    });

    await check('a pending, blocked or unknown professional has no profile', async () => {
        assert.equal((await call('GET', `/public/providers/${pending._id}`)).status, 404);
        await Worker.updateOne({ _id: pro._id }, { $set: { isActive: false } });
        assert.equal((await call('GET', `/public/providers/${pro._id}`)).status, 404);
        await Worker.updateOne({ _id: pro._id }, { $set: { isActive: true } });
        assert.equal((await call('GET', `/public/providers/${oid()}`)).status, 404);
        assert.equal((await call('GET', '/public/providers/zzz')).status, 404);
    });

    await check('an approved vendor has a profile too', async () => {
        const v = await Vendor.collection.insertOne({
            name: 'Owner', businessName: 'FixRight', email: 'fr@v.test', phone: '9600000003',
            approvalStatus: 'approved', isActive: true, service: ['Plumbing'], createdAt: new Date(),
        });
        const r = await call('GET', `/public/providers/${v.insertedId}`);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.provider.name, 'FixRight');
        assert.equal(r.json.provider.kind, 'vendor');
    });

    console.log('\n[5] entering a friend\'s code');

    const friend = await newUser();
    const code = (await call('GET', '/users/referral', null, friend.token)).json.data.code;

    await check('a new customer is offered the code box and can use a friend\'s code once', async () => {
        const joiner = await newUser();
        const summary = await call('GET', '/users/referral', null, joiner.token);
        assert.equal(summary.json.data.canApplyCode, true);
        const r = await call('POST', '/users/referral/apply', { code: code.toLowerCase() }, joiner.token);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(String((await User.findById(joiner.id).lean()).referredBy), String(friend.id));
        assert.equal((await call('GET', '/users/referral', null, joiner.token)).json.data.canApplyCode, false);
        const again = await call('POST', '/users/referral/apply', { code }, joiner.token);
        assert.equal(again.status, 400);
        assert.match(again.json.message, /already used/);
    });

    await check('never one\'s own code, an unknown one, or after booking', async () => {
        assert.match((await call('POST', '/users/referral/apply', { code }, friend.token)).json.message, /own code/);
        const other = await newUser();
        assert.equal((await call('POST', '/users/referral/apply', { code: 'SPNOPE00' }, other.token)).status, 400);
        assert.equal((await call('POST', '/users/referral/apply', { code }, booker.token)).status, 400, 'booker has a booking');
        assert.equal((await call('GET', '/users/referral', null, booker.token)).json.data.canApplyCode, false);
        assert.equal((await User.findById(other.id).lean()).referredBy, null);
    });

    await new Promise((r) => setTimeout(r, 1000));
    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
