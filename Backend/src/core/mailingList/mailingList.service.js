import crypto from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';
import { MailSubscriber, MAIL_SOURCES } from './mailSubscriber.model.js';

/**
 * The newsletter list (Food / Shop admin > Subscribed Mail List).
 *
 * Subscribing is public and answers the same way whether or not the address
 * was already on the list, so the form cannot be used to find out who is
 * subscribed. Subscribing twice changes nothing but the sources; subscribing
 * after unsubscribing puts the address back.
 *
 * Admins read it under "Customers" for the service the list is filtered to;
 * the unfiltered list needs Customers in every service.
 */

// Deliberately simple: one @, a dot in the domain, no spaces. The real check
// is the mail bouncing; this only stops obvious typos and junk.
const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const ADMIN_SERVICE = { food: 'food', quick: 'quickCommerce', shop: 'ecommerce', taxi: 'taxi', services: 'food', other: 'food' };

const newToken = () => crypto.randomBytes(24).toString('hex');

export function normaliseEmail(v) {
  const email = String(v ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RX.test(email)) throw new ApiError(400, 'Enter a valid email address');
  return email;
}

export async function subscribe({ email: emailIn, source: sourceIn } = {}) {
  const email = normaliseEmail(emailIn);
  const source = MAIL_SOURCES.includes(sourceIn) ? sourceIn : 'other';
  const now = new Date();
  // One upsert, so two quick submits of the same address cannot make two rows.
  await MailSubscriber.updateOne(
    { email },
    {
      $setOnInsert: { email, unsubscribeToken: newToken(), subscribedAt: now },
      $addToSet: { sources: source },
    },
    { upsert: true },
  ).catch(async (err) => {
    // A race on the unique index: the other request made the row; add the source.
    if (err?.code !== 11000) throw err;
    await MailSubscriber.updateOne({ email }, { $addToSet: { sources: source } });
  });
  // Coming back after unsubscribing.
  await MailSubscriber.updateOne(
    { email, status: 'unsubscribed' },
    { $set: { status: 'subscribed', subscribedAt: now, unsubscribedAt: null } },
  );
  return { subscribed: true };
}

/** The unsubscribe link. An unknown token says the same as a known one. */
export async function unsubscribe(token) {
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{48}$/.test(t)) return { unsubscribed: true };
  await MailSubscriber.updateOne(
    { unsubscribeToken: t, status: 'subscribed' },
    { $set: { status: 'unsubscribed', unsubscribedAt: new Date() } },
  );
  return { unsubscribed: true };
}

/* ---------------------------------------------------------------- admin */

function assertAccess(admin, source) {
  const services = source ? [ADMIN_SERVICE[source]] : [...new Set(Object.values(ADMIN_SERVICE))];
  const ok = services.every((service) => decideAdminAccess(admin, { service, resource: 'customers', write: false }).allowed);
  if (!ok) throw new ApiError(403, 'You do not have access to this mail list');
}

function filterFor(query = {}) {
  const source = String(query.source || '').trim();
  if (source && !MAIL_SOURCES.includes(source)) throw new ApiError(400, 'Unknown source');
  const filter = {};
  if (source) filter.sources = source;
  if (['subscribed', 'unsubscribed'].includes(query.status)) filter.status = query.status;
  const q = String(query.q || '').trim().slice(0, 80).toLowerCase();
  if (q) filter.email = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new ApiError(400, 'Pick valid dates');
  if (from || to) {
    filter.subscribedAt = {};
    if (from) filter.subscribedAt.$gte = from;
    // A date-only "to" means the whole of that day.
    if (to) filter.subscribedAt.$lte = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to)) ? new Date(to.getTime() + 86399999) : to;
  }
  return { source, filter };
}

const toRow = (d) => ({
  id: String(d._id),
  email: d.email,
  sources: d.sources || [],
  status: d.status,
  subscribedAt: d.subscribedAt,
  unsubscribedAt: d.unsubscribedAt || null,
});

export async function adminList(admin, query = {}) {
  const { source, filter } = filterFor(query);
  assertAccess(admin, source);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const sort = { subscribedAt: query.sort === 'oldest' ? 1 : -1 };
  const [docs, total] = await Promise.all([
    MailSubscriber.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    MailSubscriber.countDocuments(filter),
  ]);
  return { items: docs.map(toRow), total, page, limit };
}

// A spreadsheet runs a cell that starts with = + - @ as a formula; quote it.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function adminExportCsv(admin, query = {}) {
  const { source, filter } = filterFor(query);
  assertAccess(admin, source);
  const docs = await MailSubscriber.find(filter).sort({ subscribedAt: -1 }).limit(50000).lean();
  const lines = [['Email', 'Sources', 'Status', 'Subscribed at', 'Unsubscribed at'].join(',')];
  for (const d of docs) {
    lines.push([
      cell(d.email),
      cell((d.sources || []).join(' ')),
      cell(d.status),
      cell(d.subscribedAt ? new Date(d.subscribedAt).toISOString() : ''),
      cell(d.unsubscribedAt ? new Date(d.unsubscribedAt).toISOString() : ''),
    ].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
