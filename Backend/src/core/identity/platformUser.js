import mongoose from 'mongoose';

/**
 * The customer's one platform account, for any service's own customer id.
 *
 * Food and Taxi key customers by the platform account (`users`). Quick and
 * Services keep their own customer rows (`qc_users`, `sp_users`), linked by
 * platformUserId or, failing that, the same phone. Shared features -- the
 * inbox (core/notifications/customerInbox.js) and the wallet Quick now shares
 * (modules/quickCommerce/modules/food/user/models/userWallet.model.js) -- file
 * everything under the platform account, so they translate here.
 *
 * The id is looked up rather than trusted to the caller: Quick's code also runs
 * through Food's senders with Quick ids. ObjectIds are unique across
 * collections, so the first collection that has it is the answer.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const lastTen = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/*
 * Where a service keeps its own customers, and the service each belongs to.
 * The id is looked up rather than trusted to the caller: Quick's code sends
 * through Food's push sender too, with Quick ids, so "which service called"
 * does not say whose id it is. ObjectIds are unique across collections, so the
 * first collection that has it is the answer.
 */
const OWN_USERS = [
  ['users', null],
  ['qc_users', 'quickCommerce'],
  ['sp_users', 'serviceProvider'],
  ['ecom_users', 'ecommerce'],
];

/**
 * The customer's platform (`users`) id for any service's customer id, and which
 * service that id came from. null when there is no platform account to file it
 * under.
 */
export async function platformUserIdFor(id) {
  if (!isId(id)) return null;
  const _id = new mongoose.Types.ObjectId(String(id));
  const db = mongoose.connection;
  for (const [collection, vertical] of OWN_USERS) {
    const own = await db.collection(collection).findOne({ _id }, { projection: { platformUserId: 1, phone: 1 } });
    if (!own) continue;
    if (collection === 'users') return { platformId: String(_id), vertical: null };
    if (isId(own.platformUserId)) return { platformId: String(own.platformUserId), vertical };
    const phone = lastTen(own.phone);
    if (phone.length !== 10) return null;
    const main = await db
      .collection('users')
      .findOne({ phone: { $in: [phone, `+91${phone}`, `91${phone}`] } }, { projection: { _id: 1 } });
    return main ? { platformId: String(main._id), vertical } : null;
  }
  // A Quick id from before the qc_users merge, once its row is dropped.
  const merged = await db.collection('qc_user_id_map').findOne({ _id }, { projection: { platformId: 1 } });
  if (merged?.platformId) return { platformId: String(merged.platformId), vertical: 'quickCommerce' };
  return null;
}

const tokenList = (v) => (Array.isArray(v) ? v : [v]).map((t) => String(t || '').trim()).filter(Boolean);

/**
 * The devices the customer signed in on through the platform login, for any
 * service's own customer id.
 *
 * Web login registers the browser's FCM token on the platform account only
 * (core/auth/auth.service.js), so a service that pushes to its own customer
 * row (qc_users, sp_users, ecom_users) reached nobody who never opened that
 * service's own login. Each service's sender merges these in.
 *
 * `platform` narrows to one bucket like the senders do: 'web' reads fcmTokens,
 * 'mobile' / 'android' / 'ios' read fcmTokenMobile; omitted reads both.
 * Never throws -- a lookup failure just means no extra devices.
 */
export async function platformDeviceTokensFor(id, { platform } = {}) {
  try {
    const resolved = await platformUserIdFor(id);
    if (!resolved) return [];
    const main = await mongoose.connection
      .collection('users')
      .findOne(
        { _id: new mongoose.Types.ObjectId(resolved.platformId) },
        { projection: { fcmTokens: 1, fcmTokenMobile: 1, isActive: 1 } },
      );
    if (!main || main.isActive === false) return [];
    const p = String(platform || '').toLowerCase();
    const mobile = ['mobile', 'android', 'ios', 'app'].includes(p);
    if (p && mobile) return [...new Set(tokenList(main.fcmTokenMobile))];
    if (p) return [...new Set(tokenList(main.fcmTokens))];
    return [...new Set([...tokenList(main.fcmTokens), ...tokenList(main.fcmTokenMobile)])];
  } catch {
    return [];
  }
}

/**
 * platformDeviceTokensFor for a page of a service's customer rows at once
 * (broadcasts). Each row is { _id, platformUserId?, phone? }; the result maps
 * the row's _id to its platform account's tokens (both buckets). Two queries
 * however long the page.
 */
export async function platformDeviceTokensForMany(rows = []) {
  const out = new Map();
  try {
    const byId = new Map();
    const byPhone = new Map();
    for (const row of rows) {
      if (!row?._id) continue;
      if (isId(row.platformUserId)) byId.set(String(row._id), String(row.platformUserId));
      else if (lastTen(row.phone).length === 10) byPhone.set(String(row._id), lastTen(row.phone));
    }
    const users = mongoose.connection.collection('users');
    const projection = { fcmTokens: 1, fcmTokenMobile: 1, phone: 1, isActive: 1 };
    const ids = [...new Set(byId.values())].map((v) => new mongoose.Types.ObjectId(v));
    const phones = [...new Set(byPhone.values())].flatMap((p) => [p, `+91${p}`, `91${p}`]);
    const [mainsById, mainsByPhone] = await Promise.all([
      ids.length ? users.find({ _id: { $in: ids } }, { projection }).toArray() : [],
      phones.length ? users.find({ phone: { $in: phones } }, { projection }).toArray() : [],
    ]);
    const tokensOf = (m) =>
      !m || m.isActive === false ? [] : [...new Set([...tokenList(m.fcmTokens), ...tokenList(m.fcmTokenMobile)])];
    const idIndex = new Map(mainsById.map((m) => [String(m._id), m]));
    const phoneIndex = new Map(mainsByPhone.map((m) => [lastTen(m.phone), m]));
    for (const [rowId, pid] of byId) out.set(rowId, tokensOf(idIndex.get(pid)));
    for (const [rowId, phone] of byPhone) out.set(rowId, tokensOf(phoneIndex.get(phone)));
  } catch {
    /* no extra devices */
  }
  return out;
}

/** FCM said these tokens are dead: drop them from platform accounts too. */
export async function dropPlatformDeviceTokens(tokens = []) {
  const list = tokenList(tokens);
  if (!list.length) return;
  try {
    await mongoose.connection.collection('users').updateMany(
      { $or: [{ fcmTokens: { $in: list } }, { fcmTokenMobile: { $in: list } }] },
      { $pull: { fcmTokens: { $in: list }, fcmTokenMobile: { $in: list } } },
    );
  } catch {
    /* best effort */
  }
}

