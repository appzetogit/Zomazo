// Small taxi holes:
//  - the safety "report driver" upload took any file of any size
//  - the admin support-ticket search ran the admin's text as a regex
//
// (CORS-in-production and the deploy webhook signature are covered in
// tests/security.bypass.smoke.mjs.)
//
// Run: NODE_ENV=test MONGOMS_VERSION=7.0.24 node tests/taxi-small-holes.smoke.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

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

console.log('\n[1] safety upload is bounded and typed');
{
    const { uploadMiddleware } = await import('../src/modules/taxi/safety/routes/userSafety.routes.js');
    const errorHandler = (await import('../src/middleware/errorHandler.js')).default;
    const app = express();
    app.post('/up', uploadMiddleware, (req, res) => {
        for (const list of Object.values(req.files || {})) for (const f of list) fs.rmSync(f.path, { force: true });
        res.json({ ok: true, fields: Object.keys(req.files || {}) });
    });
    app.use(errorHandler);
    const server = http.createServer(app).listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = async (field, type, bytes) => {
        const form = new FormData();
        form.append(field, new Blob([Buffer.alloc(bytes, 1)], { type }), 'f.bin');
        const r = await fetch(`${base}/up`, { method: 'POST', body: form });
        return r.status;
    };
    const okPhoto = await send('image', 'image/jpeg', 1000);
    const okAudio = await send('audio', 'audio/webm', 1000);
    const exe = await send('image', 'application/x-msdownload', 1000);
    const htmlAsAudio = await send('audio', 'text/html', 1000);
    const huge = await send('audio', 'audio/mpeg', 16 * 1024 * 1024);
    server.close();
    check('a photo is accepted', () => assert.equal(okPhoto, 200));
    check('a voice note is accepted', () => assert.equal(okAudio, 200));
    check('an executable as the photo is refused', () => assert.equal(exe, 400));
    check('HTML as the recording is refused', () => assert.equal(htmlAsAudio, 400));
    check('a 16 MB file is refused', () => assert.equal(huge, 413));
}

console.log('\n[2] support search is literal');
{
    const { SupportTicket } = await import('../src/modules/taxi/support/models/SupportTicket.js');
    const { adminListSupportTickets } = await import('../src/modules/taxi/support/controllers/supportController.js');
    await SupportTicket.collection.insertMany([
        { ticketCode: 'TK-1', title: 'Fare charged twice', userType: 'user', requesterRole: 'user', requesterName: 'Asha', requesterPhone: '9876543210', status: 'pending', updatedAt: new Date() },
        { ticketCode: 'TK-2', title: 'Refund (a+) query', userType: 'user', requesterRole: 'user', requesterName: 'Ravi', requesterPhone: '9876543211', status: 'pending', updatedAt: new Date() },
    ]);
    const list = async (search) => {
        let body;
        await adminListSupportTickets({ query: { search } }, { json: (b) => { body = b; } });
        return body.data.results.map((t) => t.ticketCode || t.code || t.id);
    };
    const all = await list('.*');
    check("'.*' matches nothing instead of everything", () => assert.equal(all.length, 0));
    const paren = await list('(a+)');
    check('regex metacharacters are matched literally', () => assert.equal(paren.length, 1));
    const plain = await list('twice');
    check('plain search still works', () => assert.equal(plain.length, 1));
}

await mongoose.disconnect();
await mongod.stop();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures}`}\n`);
process.exit(failures ? 1 : 0);
