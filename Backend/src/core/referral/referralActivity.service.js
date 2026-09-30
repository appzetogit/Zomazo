import mongoose from 'mongoose';
import { isModuleEnabled } from '../modules/moduleState.service.js';
import { MODULES } from '../modules/moduleRegistry.js';

/**
 * Master > Referral activity: who referred whom, what it paid, and why a
 * reward was refused -- across every service that logs its referrals.
 *
 * Each service keeps its own log, keyed by its own account rows:
 *   food      food_referral_logs  customers and riders in `users` / food riders
 *   quick     qc_referral_logs    qc_users (riders: qc_delivery_partners)
 *   shop      ecom_referral_logs  ecom_users
 *   services  sp_referral_logs    sp_users (customers only)
 *   rides     taxi_referral_logs  users (customers only; rideReferralLog.js)
 */

const SOURCES = [
  { service: 'food', label: 'Food', logs: 'food_referral_logs', users: 'users', riders: 'food_delivery_partners' },
  { service: 'quick', label: 'Quick', logs: 'qc_referral_logs', users: 'qc_users', riders: 'qc_delivery_partners', module: MODULES.QUICK_COMMERCE },
  { service: 'shop', label: 'Shop', logs: 'ecom_referral_logs', users: 'ecom_users', riders: 'ecom_delivery_partners', module: MODULES.ECOMMERCE },
  { service: 'services', label: 'Services', logs: 'sp_referral_logs', users: 'sp_users', module: MODULES.SERVICE_PROVIDER },
  { service: 'rides', label: 'Rides', logs: 'taxi_referral_logs', users: 'users', module: MODULES.TAXI },
];

const coll = (name) => mongoose.connection.collection(name);
const STATUSES = ['pending', 'credited', 'rejected'];

async function namesFor(collection, ids) {
  if (!collection || !ids.length) return new Map();
  const rows = await coll(collection)
    .find({ _id: { $in: ids } })
    .project({ name: 1, phone: 1 })
    .toArray();
  return new Map(rows.map((r) => [String(r._id), { name: r.name || '', phone: r.phone || '' }]));
}

async function enabledSources(service) {
  const wanted = SOURCES.filter((s) => !service || s.service === service);
  const on = await Promise.all(wanted.map((s) => (s.module ? isModuleEnabled(s.module).catch(() => false) : true)));
  return wanted.filter((_, i) => on[i]);
}

/**
 * @param {object} query { service?, status?, from?, to?, limit? }
 * @returns {{ items, summary }} newest first; summary per service over the same filters
 */
export async function listReferralActivity(query = {}) {
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
  const status = STATUSES.includes(query.status) ? query.status : '';
  const createdAt = {};
  if (query.from && !Number.isNaN(Date.parse(query.from))) createdAt.$gte = new Date(`${query.from}T00:00:00`);
  if (query.to && !Number.isNaN(Date.parse(query.to))) createdAt.$lte = new Date(`${query.to}T23:59:59.999`);
  const filter = {
    ...(status ? { status } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
  };

  const sources = await enabledSources(String(query.service || '').trim());
  const perSource = await Promise.all(sources.map(async (src) => {
    const [docs, totals] = await Promise.all([
      coll(src.logs).find(filter).sort({ createdAt: -1 }).limit(limit).toArray(),
      coll(src.logs).aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            // Services logs name the amount `reward`, the others `rewardAmount`.
            paid: { $sum: { $ifNull: ['$rewardAmount', { $ifNull: ['$reward', 0] }] } },
          },
        },
      ]).toArray(),
    ]);

    const isRider = (d) => d.role === 'DELIVERY_PARTNER';
    const ids = (pick) => [...new Set(docs.filter(pick).flatMap((d) => [d.referrerId, d.refereeId]).filter(Boolean).map(String))]
      .map((id) => new mongoose.Types.ObjectId(id));
    const [users, riders] = await Promise.all([
      namesFor(src.users, ids((d) => !isRider(d))),
      namesFor(src.riders, ids(isRider)),
    ]);
    const who = (d, id) => (isRider(d) ? riders : users).get(String(id)) || { name: '', phone: '' };

    const byStatus = Object.fromEntries(totals.map((t) => [t._id, t]));
    return {
      summary: {
        service: src.service,
        label: src.label,
        credited: byStatus.credited?.count || 0,
        pending: byStatus.pending?.count || 0,
        rejected: byStatus.rejected?.count || 0,
        rewardsPaid: Number(byStatus.credited?.paid || 0),
      },
      items: docs.map((d) => ({
        key: `${src.service}:${d._id}`,
        service: src.service,
        serviceLabel: src.label,
        role: isRider(d) ? 'rider' : 'customer',
        referrer: who(d, d.referrerId),
        referee: { ...who(d, d.refereeId), phone: who(d, d.refereeId).phone || d.refereePhone || '' },
        reward: Number(d.rewardAmount ?? d.reward ?? 0),
        status: d.status || 'pending',
        reason: d.reason || '',
        createdAt: d.createdAt || null,
      })),
    };
  }));

  const items = perSource
    .flatMap((s) => s.items)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
  return { items, summary: perSource.map((s) => s.summary) };
}

const maskPhone = (raw) => {
  const p = String(raw || '');
  return p ? `${p.slice(0, Math.min(3, p.length))}${'*'.repeat(Math.max(p.length - 5, 0))}${p.slice(-2)}` : '';
};

/** This person's customer rows in one service's collection. */
async function rowsOfPerson(collection, platformId) {
  if (collection === 'users') return [platformId];
  const or = [{ platformUserId: platformId }];
  const me = await coll('users').findOne({ _id: platformId }, { projection: { phone: 1 } });
  const phone = String(me?.phone || '').replace(/\D/g, '').slice(-10);
  // Services rows made before the link carry only the phone.
  if (collection === 'sp_users' && phone.length === 10) or.push({ phone: { $in: [phone, `+91${phone}`, `91${phone}`] } });
  const rows = await coll(collection).find({ $or: or }).project({ _id: 1 }).toArray();
  return rows.map((r) => r._id);
}

/**
 * The friends one person invited, in every service, newest first -- one code
 * per person means an invite can land in any of them. Customer referrals only.
 * Same entry shape as Food's own list (food/user/services/userReferral.service.js),
 * plus the service it was in.
 *
 * @param {string|ObjectId} platformUserId  the person's `users` id
 */
export async function invitesOfPerson(platformUserId, { limit = 100 } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(platformUserId || ''))) return [];
  const platformId = new mongoose.Types.ObjectId(String(platformUserId));
  const sources = await enabledSources('');
  const perSource = await Promise.all(sources.map(async (src) => {
    const mine = await rowsOfPerson(src.users, platformId);
    if (!mine.length) return [];
    const docs = await coll(src.logs)
      .find({ referrerId: { $in: mine }, role: { $ne: 'DELIVERY_PARTNER' } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    const referees = await coll(src.users)
      .find({ _id: { $in: docs.map((d) => d.refereeId).filter(Boolean) } })
      .project({ name: 1, phone: 1, profileImage: 1 })
      .toArray();
    const byId = new Map(referees.map((r) => [String(r._id), r]));
    return docs.map((d) => {
      const friend = byId.get(String(d.refereeId)) || {};
      const reward = Math.max(0, Number(d.rewardAmount ?? d.reward) || 0);
      const status = String(d.status || 'pending');
      return {
        id: `${src.service}:${d._id}`,
        refereeId: String(d.refereeId || ''),
        name: String(friend.name || '').trim() || 'Friend',
        phone: maskPhone(friend.phone || d.refereePhone),
        profileImage: String(friend.profileImage || '').trim(),
        status,
        reason: String(d.reason || ''),
        rewardAmount: reward,
        earnedAmount: status === 'credited' ? reward : 0,
        invitedAt: d.createdAt || null,
        service: src.service,
        serviceLabel: src.label,
      };
    });
  }));
  return perSource
    .flat()
    .sort((a, b) => new Date(b.invitedAt || 0) - new Date(a.invitedAt || 0))
    .slice(0, limit);
}
