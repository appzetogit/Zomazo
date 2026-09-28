const Broadcast = require('../models/Broadcast');
const Notification = require('../models/Notification');
// Called through the module object, not destructured, so a test can stand in
// for Firebase without a network.
const fcm = require('./firebaseAdmin');

/**
 * Admin broadcasts to Services customers, vendors and workers.
 *
 * Each recipient gets an inbox row (the in-app bell reads sp_notifications) and
 * a push to every device token on their account. Pushes go out in FCM's
 * multicast batches of 500; a failed batch is counted and the rest carry on,
 * so one bad token set cannot stop a broadcast halfway.
 */

const AUDIENCES = {
  customers: { model: () => require('../models/User'), field: 'userId', filter: { isActive: { $ne: false } } },
  // Only partners who can actually take work: approved and not switched off.
  vendors: { model: () => require('../models/Vendor'), field: 'vendorId', filter: { isActive: { $ne: false }, approvalStatus: 'approved' } },
  workers: { model: () => require('../models/Worker'), field: 'workerId', filter: { isActive: { $ne: false }, approvalStatus: 'approved' } }
};
const AUDIENCE_KEYS = Object.keys(AUDIENCES);

const PUSH_BATCH = 500;
const PAGE = 1000;

const normalizeAudiences = (value) => {
  const list = Array.isArray(value) ? value : [value];
  const wanted = list.flatMap((v) => (v === 'all' ? AUDIENCE_KEYS : [v]));
  return [...new Set(wanted.filter((v) => AUDIENCE_KEYS.includes(v)))];
};

async function pushTokens(broadcast, audience, tokens, batchNo) {
  if (!tokens.length) return { delivered: 0, failed: 0 };
  try {
    const res = await fcm.sendPushNotification(tokens, {
      title: broadcast.title,
      body: broadcast.message,
      // Unique per batch: sendPushNotification drops a notificationId it has sent before.
      notificationId: `broadcast_${broadcast._id}_${audience}_${batchNo}`,
      data: { type: 'general', broadcastId: String(broadcast._id), link: broadcast.link || '/' }
    });
    return { delivered: Number(res?.successCount) || 0, failed: Number(res?.failureCount) || 0 };
  } catch (err) {
    console.error(`[Broadcast] Push batch ${audience}#${batchNo} failed:`, err.message);
    return { delivered: 0, failed: tokens.length };
  }
}

/** Send one audience, a page of accounts at a time. Returns the counts. */
async function sendToAudience(broadcast, audience) {
  const def = AUDIENCES[audience];
  const Model = def.model();
  const totals = { recipients: 0, devices: 0, delivered: 0, failedDevices: 0 };
  let lastId = null;
  let batchNo = 0;
  let pending = [];

  const flush = async () => {
    const out = await pushTokens(broadcast, audience, pending, batchNo++);
    totals.delivered += out.delivered;
    totals.failedDevices += out.failed;
    pending = [];
  };

  for (;;) {
    const query = { ...def.filter, ...(lastId ? { _id: { $gt: lastId } } : {}) };
    // Paged by _id rather than skip, which gets slower on every page.
    const page = await Model.find(query).select('_id fcmTokens fcmTokenMobile platformUserId phone').sort({ _id: 1 }).limit(PAGE).lean();
    if (!page.length) break;
    lastId = page[page.length - 1]._id;
    // Customers who signed in through the platform login have their devices on
    // the platform account (core/identity/platformUser.js).
    const shared = audience === 'customers'
      ? await import('../../../core/identity/platformUser.js').then((m) => m.platformDeviceTokensForMany(page))
      : new Map();

    await Notification.insertMany(page.map((doc) => ({
      [def.field]: doc._id,
      type: 'general',
      title: broadcast.title,
      message: broadcast.message,
      data: { broadcastId: String(broadcast._id), link: broadcast.link || '' }
    })), { ordered: false });
    totals.recipients += page.length;

    for (const doc of page) {
      const tokens = [...(doc.fcmTokens || []), ...(doc.fcmTokenMobile || []), ...(shared.get(String(doc._id)) || [])]
        .filter((t) => typeof t === 'string' && t.trim());
      for (const token of new Set(tokens)) {
        pending.push(token);
        totals.devices += 1;
        if (pending.length >= PUSH_BATCH) await flush();
      }
    }
  }
  if (pending.length) await flush();
  return totals;
}

// Runs started in this process, so a second call waits on the first one.
const running = new Map();

/**
 * Runs a saved broadcast to the end and records the outcome on it. Only one run
 * ever sends: it claims the broadcast first. A later call in this process gets
 * the same run's result; one elsewhere gets the record as it stands.
 */
function runBroadcast(broadcastId) {
  const key = String(broadcastId);
  if (running.has(key)) return running.get(key);
  const run = (async () => {
    const broadcast = await Broadcast.findOneAndUpdate(
      { _id: broadcastId, status: 'sending', claimedAt: null },
      { $set: { claimedAt: new Date() } },
      { new: true }
    ).lean();
    if (!broadcast) return Broadcast.findById(broadcastId).lean();
    return sendBroadcast(broadcast);
  })();
  running.set(key, run);
  run.finally(() => running.delete(key)).catch(() => {});
  return run;
}

async function sendBroadcast(broadcast) {
  const totals = { recipients: 0, devices: 0, delivered: 0, failedDevices: 0 };
  try {
    for (const audience of broadcast.audiences) {
      const t = await sendToAudience(broadcast, audience);
      for (const k of Object.keys(totals)) totals[k] += t[k];
      // Progress, so the history shows a large broadcast moving.
      await Broadcast.updateOne({ _id: broadcast._id }, { $set: totals });
    }
    return Broadcast.findByIdAndUpdate(broadcast._id, {
      $set: { ...totals, status: 'sent', finishedAt: new Date() }
    }, { new: true }).lean();
  } catch (err) {
    console.error(`[Broadcast] ${broadcast._id} failed:`, err);
    return Broadcast.findByIdAndUpdate(broadcast._id, {
      $set: { ...totals, status: 'failed', error: String(err.message || err).slice(0, 500), finishedAt: new Date() }
    }, { new: true }).lean();
  }
}

/**
 * Save a broadcast and start sending it. Resolves with the saved record at
 * once; `done` resolves when sending finishes (tests wait on it, the admin
 * route does not).
 */
async function createBroadcast({ title, message, link, audiences, sentBy }) {
  const list = normalizeAudiences(audiences);
  if (!String(title || '').trim()) throw Object.assign(new Error('Title is required'), { statusCode: 400 });
  if (!String(message || '').trim()) throw Object.assign(new Error('Message is required'), { statusCode: 400 });
  if (!list.length) throw Object.assign(new Error('Choose who to send it to: customers, vendors or workers'), { statusCode: 400 });

  const broadcast = await Broadcast.create({
    title: String(title).trim(),
    message: String(message).trim(),
    link: String(link || '').trim(),
    audiences: list,
    sentBy: sentBy || null
  });
  const done = new Promise((resolve) => setImmediate(() => runBroadcast(broadcast._id).then(resolve, () => resolve(null))));
  return { broadcast: broadcast.toObject(), done };
}

async function listBroadcasts({ page = 1, limit = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const [items, total] = await Promise.all([
    Broadcast.find({}).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    Broadcast.countDocuments({})
  ]);
  return { items, total, page: p, limit: l };
}

/** Removes a broadcast from the history. What was delivered stays delivered. */
async function deleteBroadcast(id) {
  const res = await Broadcast.deleteOne({ _id: id });
  return res.deletedCount === 1;
}

module.exports = {
  AUDIENCE_KEYS,
  normalizeAudiences,
  createBroadcast,
  runBroadcast,
  listBroadcasts,
  deleteBroadcast
};
