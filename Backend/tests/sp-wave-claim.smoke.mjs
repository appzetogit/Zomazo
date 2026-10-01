// Service-provider wave promotion is a claim: two scheduler ticks (two
// instances, or one slow tick overlapping the next) promote a booking once and
// alert its next partners once.
//
// Before: each tick read the booking, decided the wave was due, and wrote the
// promotion unconditionally -- both promoted and both alerted.
//
// Run: NODE_ENV=test MONGOMS_VERSION=7.0.24 node tests/sp-wave-claim.smoke.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const require = createRequire(import.meta.url);
let failures = 0;
const check = (name, fn) => {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(48).toString('hex');

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri());

const Booking = require('../src/modules/serviceProvider/models/Booking.js');
const Vendor = require('../src/modules/serviceProvider/models/Vendor.js');
const { BookingScheduler } = require('../src/modules/serviceProvider/services/bookingScheduler.js');
const { flushPlatformOrderSync } = require('../src/core/orders/platformOrderSync.cjs');

const vendors = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
await Vendor.collection.insertMany(vendors.map((_id) => ({ _id, isOnline: true, availability: 'AVAILABLE', name: 'V' })));

const started = new Date(Date.now() - 70 * 1000); // past the 60s wave, inside the 5 min search
const bookingId = new mongoose.Types.ObjectId();
await Booking.collection.insertOne({
    _id: bookingId,
    bookingNumber: 'BK-WAVE-1',
    bookingModel: 'vendor',
    status: 'searching',
    vendorId: null,
    workerId: null,
    currentWave: 1,
    waveStartedAt: started,
    createdAt: started,
    potentialVendors: vendors.map((vendorId, i) => ({ vendorId, distance: i + 1 })),
    notifiedVendors: vendors.slice(0, 3),
});

// Two instances. The alert is what a partner sees; count it.
let alerts = 0;
const alerted = [];
const make = () => {
    const s = new BookingScheduler(null);
    s.notifyPartners = async (_booking, partners) => { alerts += 1; alerted.push(...partners.map((p) => String(p.vendorId))); };
    return s;
};
const a = make();
const b = make();

console.log('\n[1] two concurrent ticks');
await Promise.all([a.processWaves(), b.processWaves()]);
const after = await Booking.collection.findOne({ _id: bookingId });
check('promoted exactly one wave', () => assert.equal(after.currentWave, 2));
check('alerted once', () => assert.equal(alerts, 1));
check('the alert went to wave 2 (vendors 4-6)', () => assert.deepEqual(alerted.sort(), vendors.slice(3, 6).map(String).sort()));
check('notified list holds each vendor once', () => assert.equal(after.notifiedVendors.length, 6));

console.log('\n[2] the next tick inside the new wave does nothing');
await Promise.all([a.processWaves(), b.processWaves()]);
const again = await Booking.collection.findOne({ _id: bookingId });
check('still wave 2', () => assert.equal(again.currentWave, 2));
check('no further alert', () => assert.equal(alerts, 1));

await flushPlatformOrderSync();
await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures}`}\n`);
process.exit(failures ? 1 : 0);
