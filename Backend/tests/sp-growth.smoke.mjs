/**
 * Services coupons, push broadcasts and referrals.
 *
 * Run: node tests/sp-growth.smoke.mjs
 *
 * Services had no coupons: createBooking stored whatever promoCode and
 * promoDiscount the app sent, and the price floor then overruled the discount.
 * Nor could an admin reach customers, vendors or workers except one at a time,
 * and Master's referral reward never reached Services at all.
 * What this guards:
 *   - admins create, edit, pause and delete coupons (bad input refused);
 *   - a booking with a code is priced from the coupon on the server, and every
 *     rule holds: minimum, expiry, total limit, per-customer limit, first booking;
 *   - an app-sent promoDiscount without a valid code takes nothing off;
 *   - cancelling before anyone sets out gives the coupon back;
 *   - the bill carries the coupon, so pay-at-home customers keep it;
 *   - a broadcast reaches each audience's inbox and devices, and is recorded;
 *   - a sign-up with a customer's code pays that customer what Master says,
 *     within the limit, once per phone, never for one's own code.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
process.env.JWT_SECRET ||= 'sp-coupons-broadcast-smoke-secret-that-is-long-enough-for-hs256-0123456789';

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

const main = async () => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName: 'sp_coupons_broadcast' });

    const SP = '../src/modules/serviceProvider';
    const Booking = require(`${SP}/models/Booking.js`);
    const User = require(`${SP}/models/User.js`);
    const Vendor = require(`${SP}/models/Vendor.js`);
    const Worker = require(`${SP}/models/Worker.js`);
    const Service = require(`${SP}/models/UserService.js`);
    const Admin = require(`${SP}/models/Admin.js`);
    const Coupon = require(`${SP}/models/Coupon.js`);
    const CouponUsage = require(`${SP}/models/CouponUsage.js`);
    const Notification = require(`${SP}/models/Notification.js`);
    const Broadcast = require(`${SP}/models/Broadcast.js`);
    const VendorBill = require(`${SP}/models/VendorBill.js`);
    for (const M of [Booking, User, Service, Worker, Coupon, CouponUsage, Notification, Broadcast, VendorBill]) {
        await M.createCollection().catch(() => {});
    }
    await Promise.all([Coupon.init(), Worker.init()]).catch(() => {});

    // Firebase stands in: each call records its tokens and "delivers" them all.
    const fcm = require(`${SP}/services/firebaseAdmin.js`);
    const pushed = [];
    fcm.sendPushNotification = async (tokens, payload) => {
        pushed.push({ tokens: [...tokens], payload });
        return { successCount: tokens.length, failureCount: 0 };
    };

    const { createBooking, cancelBooking } = require(`${SP}/controllers/bookingControllers/userBookingController.js`);
    const broadcastService = require(`${SP}/services/broadcastService.js`);
    const referralService = require(`${SP}/services/referralService.js`);
    const { generateAccessToken } = require(`${SP}/utils/tokenService.js`);
    const spRouter = require(`${SP}/routes/index.js`);

    const app = express();
    app.use(express.json());
    app.use('/api/v1/sp', spRouter);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1/sp`;

    const admin = await Admin.create({
        // A Services superadmin, as sp.endpoints.smoke uses: every /admin request
        // passes cityManagement's router-wide isSuperAdmin first.
        name: 'Ops', email: 'ops@sp.test', password: 'Passw0rd!', role: 'super_admin',
        admin_type: 'superadmin', adminLevel: 'sp_superadmin', permissions: ['*'],
        servicesAccess: ['serviceProvider'], isActive: true,
    });
    const adminToken = generateAccessToken({ userId: String(admin._id), role: 'admin' });
    const call = async (method, path, body, token = adminToken) => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty */ }
        return { status: res.status, json };
    };

    const oid = () => new mongoose.Types.ObjectId();
    let seq = 9800000000;
    const serviceId = oid();
    await Service.collection.insertOne({ _id: serviceId, title: 'AC repair', basePrice: 500, category: 'Appliance' });
    const newUser = async (extra = {}) => {
        const _id = oid();
        await User.collection.insertOne({ _id, name: 'U', email: `c${seq}@t.test`, phone: String(seq++), wallet: { balance: 0, penalty: 0 }, isActive: true, ...extra });
        return _id;
    };
    const fakeRes = () => ({
        statusCode: 200, body: null,
        status(c) { this.statusCode = c; return this; },
        json(p) { this.body = p; return this; },
    });
    const book = async (userId, extra = {}) => {
        const res = fakeRes();
        await createBooking({
            user: { id: String(userId) },
            body: {
                serviceId: String(serviceId),
                address: { addressLine1: '1 St', city: 'Pune', state: 'MH', pincode: '411001', lat: 18.52, lng: 73.85 },
                scheduledDate: new Date(Date.now() + 86400000).toISOString(),
                scheduledTime: '10:00',
                timeSlot: { start: '10:00', end: '11:00' },
                paymentMethod: 'pay_at_home',
                ...extra,
            },
        }, res);
        return res;
    };
    const day = 86400000;

    console.log('\n[1] admin coupons');

    let fixit;
    await check('an admin creates a coupon; the code is stored upper-case', async () => {
        const r = await call('POST', '/admin/coupons', {
            couponCode: 'fixit15', title: '15% off', discountType: 'percentage', discountValue: 15,
            maxDiscount: 60, minOrderValue: 300, usageLimit: 10, perUserLimit: 1,
        });
        assert.equal(r.status, 201, JSON.stringify(r.json));
        fixit = r.json.data;
        assert.equal(fixit.couponCode, 'FIXIT15');
        assert.equal(fixit.usedCount, 0);
    });

    await check('bad coupons are refused: over 100%, duplicate code, no value', async () => {
        assert.equal((await call('POST', '/admin/coupons', { couponCode: 'TOOMUCH', discountType: 'percentage', discountValue: 150 })).status, 400);
        assert.equal((await call('POST', '/admin/coupons', { couponCode: 'FIXIT15', discountValue: 5 })).status, 400);
        assert.equal((await call('POST', '/admin/coupons', { couponCode: 'NOVALUE' })).status, 400);
    });

    await check('the list shows it; an edit cannot reset the used count', async () => {
        const list = await call('GET', '/admin/coupons');
        assert.equal(list.status, 200);
        assert.deepEqual(list.json.data.map((c) => c.couponCode), ['FIXIT15']);
        const r = await call('PUT', `/admin/coupons/${fixit._id}`, { title: 'Fifteen off', usedCount: 99 });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.data.title, 'Fifteen off');
        assert.equal(r.json.data.usedCount, 0);
    });

    await check('the coupon screens are admin-only', async () => {
        const u = await newUser();
        const userToken = generateAccessToken({ userId: String(u), role: 'USER' });
        assert.equal((await call('GET', '/admin/coupons', null, userToken)).status, 403);
    });

    console.log('\n[2] booking with a code');

    const firstUser = await newUser();
    let firstBooking;
    await check('a valid code is priced on the server: 15% of 500, capped at 60', async () => {
        const r = await book(firstUser, { promoCode: 'fixit15', promoDiscount: 400 });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.finalAmount, 440);
        assert.equal(r.body.data.promoCode, 'FIXIT15');
        assert.equal(r.body.data.promoDiscount, 60);
        firstBooking = r.body.data._id;
        assert.equal((await Coupon.findById(fixit._id).lean()).usedCount, 1);
        assert.equal(await CouponUsage.countDocuments({ couponId: fixit._id, userId: firstUser }), 1);
    });

    await check('the same customer cannot use it twice', async () => {
        const r = await book(firstUser, { promoCode: 'FIXIT15' });
        assert.equal(r.statusCode, 400);
        assert.equal(r.body.code, 'COUPON_INVALID');
        assert.match(r.body.message, /already used/);
    });

    await check('an app-sent discount with no code takes nothing off', async () => {
        const r = await book(await newUser(), { amount: 100, basePrice: 500, tax: 0, visitingCharges: 0, promoDiscount: 400 });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.finalAmount, 500);
        assert.equal(r.body.data.promoDiscount, 0);
    });

    await check('the minimum booking value holds', async () => {
        await Coupon.create({ couponCode: 'BIG1000', discountType: 'flat-price', discountValue: 100, minOrderValue: 1000 });
        const r = await book(await newUser(), { promoCode: 'BIG1000' });
        assert.equal(r.statusCode, 400);
        assert.match(r.body.message, /at least ₹1000/);
    });

    await check('an expired or paused coupon is refused, an unknown code too', async () => {
        await Coupon.create({ couponCode: 'OLDONE', discountType: 'flat-price', discountValue: 50, startDate: new Date(Date.now() - 10 * day), endDate: new Date(Date.now() - day) });
        await Coupon.create({ couponCode: 'RESTING', discountType: 'flat-price', discountValue: 50, status: 'paused' });
        const u = await newUser();
        assert.match((await book(u, { promoCode: 'OLDONE' })).body.message, /expired/);
        assert.match((await book(u, { promoCode: 'RESTING' })).body.message, /not active/);
        assert.match((await book(u, { promoCode: 'NOPE' })).body.message, /not valid/);
    });

    await check('the total limit holds, and a refused booking is not created', async () => {
        await Coupon.create({ couponCode: 'LASTONE', discountType: 'flat-price', discountValue: 50, usageLimit: 1 });
        const a = await newUser();
        const b = await newUser();
        assert.equal((await book(a, { promoCode: 'LASTONE' })).statusCode, 201);
        const r = await book(b, { promoCode: 'LASTONE' });
        assert.equal(r.statusCode, 400);
        assert.match(r.body.message, /fully used/);
        assert.equal(await Booking.countDocuments({ userId: b }), 0);
    });

    await check('a first-booking coupon is refused once the customer has booked', async () => {
        await Coupon.create({ couponCode: 'HELLO', discountType: 'flat-price', discountValue: 75, customerScope: 'first-time' });
        const fresh = await newUser();
        const r = await book(fresh, { promoCode: 'HELLO' });
        assert.equal(r.statusCode, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.finalAmount, 425);
        assert.match((await book(firstUser, { promoCode: 'HELLO' })).body.message, /first booking/);
    });

    await check('a customer can check a code before booking', async () => {
        const u = await newUser();
        const token = generateAccessToken({ userId: String(u), role: 'USER' });
        const ok = await call('POST', '/users/coupons/validate', { code: 'fixit15', amount: 400 }, token);
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.equal(ok.json.data.discount, 60);
        const low = await call('POST', '/users/coupons/validate', { code: 'fixit15', amount: 100 }, token);
        assert.equal(low.status, 400);
        const list = await call('GET', '/users/coupons', null, token);
        assert.ok(list.json.data.some((c) => c.couponCode === 'FIXIT15'));
        assert.ok(!list.json.data.some((c) => c.couponCode === 'RESTING'));
    });

    console.log('\n[3] after the booking');

    await check('cancelling before anyone sets out gives the coupon back', async () => {
        const res = fakeRes();
        await cancelBooking({ user: { id: String(firstUser) }, params: { id: String(firstBooking) }, body: {} }, res);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.equal((await Coupon.findById(fixit._id).lean()).usedCount, 0);
        assert.equal(await CouponUsage.countDocuments({ bookingId: firstBooking }), 0);
        // ...so the customer may use it again.
        assert.equal((await book(firstUser, { promoCode: 'FIXIT15' })).statusCode, 201);
    });

    await check('the bill keeps the coupon: the customer pays the bill less the discount', async () => {
        const vendorId = oid();
        await Vendor.collection.insertOne({ _id: vendorId, name: 'V', businessName: 'V', phone: String(seq++), email: `v${seq}@t.test`, approvalStatus: 'approved', isActive: true });
        const b = await Booking.findOne({ userId: firstUser, promoCode: 'FIXIT15', status: { $ne: 'cancelled' } });
        await Booking.updateOne({ _id: b._id }, { $set: { vendorId, status: 'in_progress', bookingModel: 'vendor' } });
        const { createOrUpdateBill } = require(`${SP}/controllers/vendorControllers/vendorBillController.js`);
        const res = fakeRes();
        await createOrUpdateBill({
            params: { bookingId: String(b._id) },
            body: { services: [], parts: [], customItems: [] },
            user: { id: String(vendorId) },
            userRole: 'VENDOR',
        }, res);
        assert.ok(res.statusCode < 300, JSON.stringify(res.body));
        const bill = await VendorBill.findOne({ bookingId: b._id }).lean();
        assert.equal(bill.couponDiscount, 60);
        const before = bill.grandTotal + bill.couponDiscount;
        assert.equal(Math.round(bill.companyRevenue * 100), Math.round((bill.grandTotal - bill.vendorTotalEarning) * 100));
        assert.ok(before > bill.grandTotal);
        assert.equal((await Booking.findById(b._id).lean()).finalAmount, bill.grandTotal);
    });

    console.log('\n[4] broadcast');

    const custA = await newUser({ fcmTokens: ['c-web-1'], fcmTokenMobile: ['c-mob-1', 'c-web-1'] });
    await Vendor.collection.insertMany([
        { name: 'V ok', phone: String(seq++), email: `v${seq}@t.test`, approvalStatus: 'approved', isActive: true, fcmTokens: ['v-1'] },
        { name: 'V pending', phone: String(seq++), email: `v${seq}@t.test`, approvalStatus: 'pending', isActive: true, fcmTokens: ['v-pending'] },
    ]);
    await Worker.collection.insertOne({ name: 'W', phone: String(seq++), email: `w${seq}@t.test`, approvalStatus: 'approved', isActive: true, fcmTokenMobile: ['w-1'] });

    await check('an empty or audience-less broadcast is refused', async () => {
        assert.equal((await call('POST', '/admin/notifications/broadcast', { title: '', message: 'x', audiences: ['customers'] })).status, 400);
        assert.equal((await call('POST', '/admin/notifications/broadcast', { title: 'x', message: 'x', audiences: ['martians'] })).status, 400);
    });

    await check('customers only: every customer gets an inbox row, devices get a push, no one else', async () => {
        pushed.length = 0;
        const r = await call('POST', '/admin/notifications/broadcast', { title: 'Monsoon offer', message: 'AC service 20% off', audiences: ['customers'] });
        assert.equal(r.status, 202, JSON.stringify(r.json));
        const done = await broadcastService.runBroadcast(r.json.data._id);
        const customers = await User.countDocuments({});
        assert.equal(done.status, 'sent');
        assert.equal(done.recipients, customers);
        assert.equal(await Notification.countDocuments({ title: 'Monsoon offer', userId: { $ne: null } }), customers);
        const tokens = pushed.flatMap((p) => p.tokens);
        assert.ok(tokens.includes('c-web-1') && tokens.includes('c-mob-1'));
        // One device signed in on both web and app lists is pushed once.
        assert.equal(tokens.filter((t) => t === 'c-web-1').length, 1);
        assert.ok(!tokens.includes('v-1') && !tokens.includes('w-1'));
        assert.equal(await Notification.countDocuments({ title: 'Monsoon offer', vendorId: { $ne: null } }), 0);
    });

    await check('all: approved vendors and workers too, not pending ones; recorded in the history', async () => {
        pushed.length = 0;
        const { broadcast, done } = await broadcastService.createBroadcast({ title: 'Diwali', message: 'Happy Diwali', audiences: 'all' });
        const finished = await done;
        const tokens = pushed.flatMap((p) => p.tokens);
        assert.ok(tokens.includes('v-1') && tokens.includes('w-1'));
        assert.ok(!tokens.includes('v-pending'));
        assert.equal(finished.status, 'sent');
        assert.equal(finished.delivered, finished.devices);
        const hist = await call('GET', '/admin/notifications/broadcast');
        assert.equal(hist.status, 200);
        assert.ok(hist.json.data.items.some((b) => String(b._id) === String(broadcast._id)));
        assert.equal(await Notification.countDocuments({ title: 'Diwali', workerId: { $ne: null } }), 1);
        // Every approved vendor (the coupon checks made one too), never the pending one.
        const approvedVendors = await Vendor.countDocuments({ approvalStatus: 'approved', isActive: true });
        assert.equal(await Notification.countDocuments({ title: 'Diwali', vendorId: { $ne: null } }), approvedVendors);
    });

    await check('a failed push batch is counted, and the broadcast still finishes', async () => {
        const real = fcm.sendPushNotification;
        fcm.sendPushNotification = async () => { throw new Error('FCM down'); };
        try {
            const { done } = await broadcastService.createBroadcast({ title: 'Down', message: 'x', audiences: ['workers'] });
            const finished = await done;
            assert.equal(finished.status, 'sent');
            assert.equal(finished.delivered, 0);
            assert.equal(finished.failedDevices, 1);
            assert.equal(finished.recipients, 1);
        } finally {
            fcm.sendPushNotification = real;
        }
    });

    console.log('\n[5] referral');

    const resolver = await import('../src/core/config/resolver.service.js');
    const setMaster = (key, value) => resolver.set(key, { level: 'vertical', scopeId: 'serviceProvider', value });
    const { generateVerificationToken } = require(`${SP}/utils/tokenService.js`);
    const signUp = async (phone, referralCode) => {
        const res = await fetch(`${base}/users/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'New', verificationToken: generateVerificationToken(phone), referralCode }),
        });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    const referrer = await newUser();
    const referrerToken = generateAccessToken({ userId: String(referrer), role: 'USER' });
    let code;
    const balanceOf = async (id) => Number((await User.findById(id).lean())?.wallet?.balance) || 0;

    await check('a customer gets a code; with nothing set in Master it pays nothing', async () => {
        const r = await call('GET', '/users/referral', null, referrerToken);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        code = r.json.data.code;
        assert.match(code, /^SP[0-9A-F]{6}$/);
        assert.equal(r.json.data.active, false);
        assert.equal((await call('GET', '/users/referral', null, referrerToken)).json.data.code, code, 'the code is kept');
        const s = await signUp('9111111111', code);
        assert.equal(s.status, 201, JSON.stringify(s.json));
        assert.equal(await balanceOf(referrer), 0);
    });

    await check("Master's Services reward is paid at sign-up, up to the limit", async () => {
        await setMaster('referral.customerReward', 40);
        await setMaster('referral.customerLimit', 2);
        assert.equal((await signUp('9111111112', code.toLowerCase())).status, 201);
        assert.equal(await balanceOf(referrer), 40);
        assert.equal((await signUp('9111111113', code)).status, 201);
        assert.equal(await balanceOf(referrer), 80);
        assert.equal((await signUp('9111111114', code)).status, 201, 'sign-up still works past the limit');
        assert.equal(await balanceOf(referrer), 80, 'but pays nothing more');
        const joined = await User.findOne({ phone: '9111111112' }).lean();
        assert.equal(String(joined.referredBy), String(referrer));
    });

    await check("an unknown code or one's own never pays, and never blocks sign-up", async () => {
        await setMaster('referral.customerLimit', 10);
        assert.equal((await signUp('9111111115', 'SPNOPE00')).status, 201);
        const selfPhone = (await User.findById(referrer).lean()).phone;
        const r = await referralService.applyReferralAtSignup({ refereeId: referrer, refereePhone: selfPhone, code });
        assert.equal(r.status, 'self');
        assert.equal(await balanceOf(referrer), 80);
    });

    await check('the same phone never pays twice', async () => {
        await User.deleteOne({ phone: '9111111112' });
        assert.equal((await signUp('9111111112', code)).status, 201);
        assert.equal(await balanceOf(referrer), 80);
    });

    // Background tasks scheduled with setImmediate may still be running.
    await new Promise((r) => setTimeout(r, 1000));
    server.close();
    await mongoose.disconnect();
    await replSet.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
