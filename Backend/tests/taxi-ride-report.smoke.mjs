/**
 * Taxi Ride Report: filters, columns, totals and the CSV.
 *
 * Run: node tests/taxi-ride-report.smoke.mjs
 *
 * The taxi panel had user, driver and finance reports but none for rides. What
 * this guards:
 *   - /admin/reports/ride returns the ride columns, a page, and totals over every
 *     matching ride;
 *   - each filter narrows it: status, vehicle type, city, zone (by pickup point),
 *     payment and date range;
 *   - /admin/reports/ride/download is a CSV with the same columns;
 *   - the report sits behind the admin guard.
 */
import assert from 'node:assert/strict';
import express from 'express';
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
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('taxi_ride_report');
await mongoose.connect(mongo.getUri('taxi_ride_report'));

const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { User } = await import('../src/modules/taxi/user/models/User.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
const { ServiceLocation } = await import('../src/modules/taxi/admin/models/ServiceLocation.js');
const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1/taxi`;

const owner = await FoodAdmin.create({
    email: 'owner@x.in', password: 'secret1', name: 'Owner', adminLevel: 'platform_superadmin',
    admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'medical', 'taxi'],
});
const token = signAccessToken({ userId: String(owner._id), sub: String(owner._id), role: 'ADMIN' });
const get = async (path, { auth = true } = {}) => {
    const res = await fetch(`${base}${path}`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
};

// Fixture: two cities, a zone drawn round part of the first, two vehicle types.
const insert = async (Model, doc) => (await Model.collection.insertOne({ createdAt: new Date(), updatedAt: new Date(), ...doc })).insertedId;
const pune = await insert(ServiceLocation, { name: 'Pune', service_location_name: 'Pune' });
const goa = await insert(ServiceLocation, { name: 'Goa', service_location_name: 'Goa' });
const centre = await insert(Zone, {
    name: 'Pune Centre', service_location_id: pune,
    geometry: { type: 'Polygon', coordinates: [[[73.8, 18.5], [73.9, 18.5], [73.9, 18.6], [73.8, 18.6], [73.8, 18.5]]] },
});
const bike = await insert(Vehicle, { name: 'Bike', transport_type: 'taxi' });
const sedan = await insert(Vehicle, { name: 'Sedan', transport_type: 'taxi' });
const asha = await insert(User, { name: 'Asha', phone: '9000000001' });
const ravi = await insert(Driver, { name: 'Ravi', phone: '9000000002', vehicleType: 'bike' });

const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const ride = (over) => insert(Ride, {
    userId: asha, driverId: ravi, vehicleTypeId: bike, service_location_id: pune,
    pickupLocation: point(73.85, 18.55), dropLocation: point(73.86, 18.56),
    pickupAddress: 'FC Road', dropAddress: 'JM Road', estimatedDistanceMeters: 4200,
    fare: 120, commissionAmount: 24, driverEarnings: 96, paymentMethod: 'cash', status: 'completed',
    transport_type: 'taxi', createdAt: new Date(), ...over,
});
const inZone = await ride({});
await ride({ status: 'cancelled', fare: 0, commissionAmount: 0, paymentMethod: 'online' });
await ride({ vehicleTypeId: sedan, pickupLocation: point(73.95, 18.65), fare: 300, commissionAmount: null, driverEarnings: 250 });
await ride({ service_location_id: goa, pickupLocation: point(73.8, 15.4), fare: 200, commissionAmount: 40 });
await ride({ createdAt: new Date('2024-01-15T10:00:00Z'), fare: 80, commissionAmount: 16 });

const q = (params) => `/admin/reports/ride?${new URLSearchParams(params)}`;

await check('the report is closed without an admin token', async () => {
    const r = await get(q({}), { auth: false });
    assert.ok(r.status === 401 || r.status === 403, `status ${r.status}`);
});

await check('every ride, with the ride columns and totals over all of them', async () => {
    const r = await get(q({}));
    assert.equal(r.status, 200, r.text.slice(0, 300));
    const d = r.json.data;
    assert.deepEqual(d.headers, [
        'ride_id', 'date', 'user', 'user_phone', 'driver', 'driver_phone', 'vehicle', 'city',
        'pickup', 'drop', 'distance_km', 'fare', 'commission', 'payment_method', 'status',
    ]);
    assert.equal(d.summary.rides, 5);
    assert.equal(d.summary.fare, 700);
    // 24 + 0 + (300 - 250) + 40 + 16: a ride with no commission recorded counts what the driver was not paid.
    assert.equal(d.summary.commission, 130);
    const row = d.results.find((x) => x.ride_id === String(inZone));
    assert.equal(row.user, 'Asha');
    assert.equal(row.driver, 'Ravi');
    assert.equal(row.vehicle, 'Bike');
    assert.equal(row.city, 'Pune');
    assert.equal(row.pickup, 'FC Road');
    assert.equal(row.distance_km, 4.2);
    assert.equal(row.commission, 24);
});

await check('status narrows it', async () => {
    const r = await get(q({ status: 'cancelled' }));
    assert.equal(r.json.data.summary.rides, 1);
    assert.equal(r.json.data.results[0].payment_method, 'online');
});

await check('vehicle type narrows it', async () => {
    const r = await get(q({ vehicle_type_id: String(sedan) }));
    assert.equal(r.json.data.summary.rides, 1);
    assert.equal(r.json.data.results[0].vehicle, 'Sedan');
});

await check('city narrows it', async () => {
    const r = await get(q({ service_location_id: String(goa) }));
    assert.equal(r.json.data.summary.rides, 1);
    assert.equal(r.json.data.results[0].city, 'Goa');
});

await check('zone keeps only rides picked up inside it', async () => {
    const r = await get(q({ zone_id: String(centre) }));
    // The sedan ride was picked up outside the polygon, the Goa ride far away.
    assert.equal(r.json.data.summary.rides, 3);
});

await check('payment narrows it', async () => {
    const r = await get(q({ payment_type: 'online' }));
    assert.equal(r.json.data.summary.rides, 1);
});

await check('a date range keeps only rides inside it', async () => {
    const r = await get(q({ date_option: 'range', from_date: '2024-01-01', to_date: '2024-01-31' }));
    assert.equal(r.json.data.summary.rides, 1);
    assert.equal(r.json.data.results[0].fare, 80);
});

await check('pages are pages; totals are not', async () => {
    const r = await get(q({ page: 2, limit: 2 }));
    assert.equal(r.json.data.results.length, 2);
    assert.equal(r.json.data.paginator.last_page, 3);
    assert.equal(r.json.data.summary.rides, 5);
});

await check('an unknown zone is a 404, not every ride', async () => {
    const r = await get(q({ zone_id: String(new mongoose.Types.ObjectId()) }));
    assert.equal(r.status, 404, r.text.slice(0, 200));
});

await check('the download is a CSV with the same columns', async () => {
    const r = await get(`/admin/reports/ride/download?${new URLSearchParams({ file_format: 'csv', status: 'completed' })}`);
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/csv/);
    const lines = r.text.trim().split('\n');
    assert.match(lines[0], /^ride_id,date,user,/);
    assert.equal(lines.length, 1 + 4);
});

server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
