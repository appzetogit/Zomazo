import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { User } from '../../../../core/users/user.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { DeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { Order } from '../../orders/models/order.model.js';
import { CoinLot } from '../../coins/models/coin.model.js';
import * as firebase from '../../../../core/notifications/firebase.service.js';
import { getSellerTimezone } from '../../../../utils/timezone.js';
import { logger } from '../../../../utils/logger.js';
import {
    PushCampaign,
    PushCampaignDelivery,
    MarketingPushSettings,
    NotificationPreference,
    AUDIENCE_TYPES,
    DEEP_LINK_TYPES,
} from '../models/pushCampaign.model.js';

/**
 * Scheduled, segmented marketing push campaigns.
 *
 * A campaign has an audience (a segment resolved when it runs), a schedule
 * (now, once at a time, or daily/weekly until an end date) and a deep link.
 * Each run ("occurrence", keyed by runKey) writes one delivery row per person
 * under a unique index, then sends the pending rows in throttled batches. A
 * run repeated after a crash, or twice by two workers, finds its rows already
 * there and already sent, so nobody gets the same push twice.
 *
 * Every send respects the person's marketing opt-out, the daily frequency cap
 * and quiet hours (store timezone). The due-campaign sweep runs from the
 * BullMQ maintenance worker, or from scripts/run-scheduled-jobs.js without Redis.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_RUN_MS = 10 * 60 * 1000;
const NOT_REAL = ['cancelled_by_user', 'cancelled_by_seller', 'cancelled_by_admin', 'pending_payment'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The push sender; tests swap it for a recorder. */
let pushSender = (target, payload) => firebase.notifyOwnerSafely(target, payload);
export const setPushSenderForTests = (fn) => {
    pushSender = fn || ((target, payload) => firebase.notifyOwnerSafely(target, payload));
};

const toOid = (value, field = 'id') => {
    if (!value || !mongoose.Types.ObjectId.isValid(String(value))) throw new ValidationError(`${field} is invalid`);
    return new mongoose.Types.ObjectId(String(value));
};

// ---------------------------------------------------------------------------
// Store-timezone time helpers
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (hhmm) => {
    const m = TIME_RE.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Wall-clock parts of a moment in the store timezone. */
export function localParts(date, timeZone = getSellerTimezone()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const hour = Number(get('hour')) % 24;
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour,
        minute: Number(get('minute')),
        dow,
        minutes: hour * 60 + Number(get('minute')),
        dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    };
}

/** The UTC moment of a store-local wall-clock time. */
function zonedTime(year, month, day, minutes, timeZone = getSellerTimezone()) {
    const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
    const p = localParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    return new Date(guess - (asUtc - guess));
}

/** Whether `now` falls in quiet hours; if so, when they end. */
export function quietHoursState(settings, now = new Date()) {
    const q = settings?.quietHours;
    if (!q?.enabled) return { quiet: false };
    const start = toMinutes(q.start);
    const end = toMinutes(q.end);
    if (start === null || end === null || start === end) return { quiet: false };
    const { minutes } = localParts(now);
    const quiet = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    if (!quiet) return { quiet: false };
    const wait = ((end - minutes + 1440) % 1440) * 60 * 1000;
    const until = new Date(Math.floor((now.getTime() + wait) / 60000) * 60000);
    return { quiet: true, until };
}

/**
 * The next time a schedule fires strictly after `after`, or null when it has
 * no more (a one-off already due, or past a recurring schedule's end).
 */
export function nextOccurrence(schedule = {}, after = new Date()) {
    const type = schedule.type || 'now';
    if (type !== 'recurring') return null;
    const minutes = toMinutes(schedule.timeOfDay) ?? 600;
    const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek.map(Number) : [];
    const floor = schedule.startsAt && new Date(schedule.startsAt) > after ? new Date(schedule.startsAt) : after;
    const base = localParts(floor);
    for (let i = 0; i <= 8; i += 1) {
        const dayUtc = new Date(Date.UTC(base.year, base.month - 1, base.day) + i * DAY_MS);
        const candidate = zonedTime(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth() + 1, dayUtc.getUTCDate(), minutes);
        if (candidate <= after) continue;
        if (schedule.startsAt && candidate < new Date(schedule.startsAt)) continue;
        if (schedule.frequency === 'weekly' && days.length && !days.includes(dayUtc.getUTCDay())) continue;
        if (schedule.endsAt && candidate > new Date(schedule.endsAt)) return null;
        return candidate;
    }
    return null;
}

const runKeyFor = (schedule, at) => (schedule?.type === 'recurring' ? new Date(at).toISOString() : 'once');

// ---------------------------------------------------------------------------
// Settings and preferences
// ---------------------------------------------------------------------------

export async function getMarketingPushSettings() {
    const doc = await MarketingPushSettings.findOneAndUpdate(
        { key: 'default' },
        { $setOnInsert: { key: 'default' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return {
        dailyCap: Number(doc.dailyCap ?? 3),
        quietHours: {
            enabled: doc.quietHours?.enabled !== false,
            start: doc.quietHours?.start || '22:00',
            end: doc.quietHours?.end || '08:00',
        },
        batchSize: Number(doc.batchSize || 200),
        batchDelayMs: Number(doc.batchDelayMs ?? 1000),
        timezone: getSellerTimezone(),
        updatedAt: doc.updatedAt || null,
    };
}

export async function updateMarketingPushSettings(body = {}, adminId = null) {
    const set = {};
    if (body.dailyCap !== undefined) {
        const cap = Number(body.dailyCap);
        if (!Number.isInteger(cap) || cap < 0 || cap > 50) throw new ValidationError('dailyCap must be a whole number from 0 to 50');
        set.dailyCap = cap;
    }
    if (body.quietHours) {
        if (body.quietHours.enabled !== undefined) set['quietHours.enabled'] = Boolean(body.quietHours.enabled);
        for (const k of ['start', 'end']) {
            if (body.quietHours[k] !== undefined) {
                if (toMinutes(body.quietHours[k]) === null) throw new ValidationError(`quietHours.${k} must be HH:mm`);
                set[`quietHours.${k}`] = body.quietHours[k];
            }
        }
    }
    if (body.batchSize !== undefined) {
        const n = Number(body.batchSize);
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw new ValidationError('batchSize must be from 1 to 1000');
        set.batchSize = n;
    }
    if (body.batchDelayMs !== undefined) {
        const n = Number(body.batchDelayMs);
        if (!Number.isFinite(n) || n < 0 || n > 60000) throw new ValidationError('batchDelayMs must be from 0 to 60000');
        set.batchDelayMs = Math.floor(n);
    }
    if (adminId && mongoose.Types.ObjectId.isValid(String(adminId))) set.updatedBy = toOid(adminId);
    await MarketingPushSettings.updateOne({ key: 'default' }, { $set: set }, { upsert: true });
    return getMarketingPushSettings();
}

export async function getNotificationPreferences(ownerType, ownerId) {
    const doc = await NotificationPreference.findOne({ ownerType, ownerId: toOid(ownerId, 'owner id') }).lean();
    return { marketingPush: doc ? doc.marketingPush !== false : true };
}

export async function setNotificationPreferences(ownerType, ownerId, body = {}) {
    if (typeof body.marketingPush !== 'boolean') throw new ValidationError('marketingPush must be true or false');
    await NotificationPreference.updateOne(
        { ownerType, ownerId: toOid(ownerId, 'owner id') },
        { $set: { marketingPush: body.marketingPush } },
        { upsert: true },
    );
    return getNotificationPreferences(ownerType, ownerId);
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const users = (ids) => ids.map((id) => ({ ownerType: 'USER', ownerId: String(id) }));

async function activeCustomerIds(filterIds = null) {
    const query = { isActive: { $ne: false } };
    if (filterIds) query._id = { $in: filterIds };
    const rows = await User.find(query).select('_id').lean();
    return rows.map((r) => r._id);
}

/**
 * Everyone a campaign's audience means right now, as push targets.
 * Opt-outs are not removed here: they are counted as skipped at send time.
 */
export async function resolveAudience(audience = {}, now = new Date()) {
    const type = audience.type;
    if (type === 'all_customers') return users(await activeCustomerIds());

    if (type === 'sellers') {
        const rows = await Seller.find({ status: 'approved' }).select('_id').lean();
        return rows.map((r) => ({ ownerType: 'SELLER', ownerId: String(r._id) }));
    }
    if (type === 'riders') {
        const rows = await DeliveryPartner.find({ status: 'approved' }).select('_id').lean();
        return rows.map((r) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: String(r._id) }));
    }

    if (type === 'zone') {
        const zoneIds = (audience.zoneIds || []).filter((z) => mongoose.Types.ObjectId.isValid(String(z))).map((z) => toOid(z));
        if (!zoneIds.length) return [];
        const ids = await Order.distinct('userId', { zoneId: { $in: zoneIds }, orderStatus: { $nin: NOT_REAL } });
        return users(await activeCustomerIds(ids));
    }

    if (type === 'channel') {
        const days = Math.max(1, Number(audience.days) || 30);
        const query = { createdAt: { $gte: new Date(now.getTime() - days * DAY_MS) }, orderStatus: { $nin: NOT_REAL } };
        if (audience.channel === 'quick') query.fulfilmentMode = 'quick';
        if (audience.channel === 'shop') query.fulfilmentMode = 'standard';
        const ids = await Order.distinct('userId', query);
        return users(await activeCustomerIds(ids));
    }

    if (type === 'inactive') {
        // Ordered before, but not in the last N days.
        const days = Math.max(1, Number(audience.days) || 30);
        const cutoff = new Date(now.getTime() - days * DAY_MS);
        const rows = await Order.aggregate([
            { $match: { orderStatus: { $nin: NOT_REAL } } },
            { $group: { _id: '$userId', last: { $max: '$createdAt' } } },
            { $match: { last: { $lt: cutoff } } },
        ]);
        return users(await activeCustomerIds(rows.map((r) => r._id)));
    }

    if (type === 'never_ordered') {
        const ordered = await Order.distinct('userId', { orderStatus: { $nin: NOT_REAL } });
        const rows = await User.find({ isActive: { $ne: false }, _id: { $nin: ordered } }).select('_id').lean();
        return users(rows.map((r) => r._id));
    }

    if (type === 'coin_balance') {
        const min = Math.max(0, Number(audience.minCoins) || 0);
        const rows = await CoinLot.aggregate([
            { $match: { expiredAt: null, expiresAt: { $gt: now } } },
            { $group: { _id: '$userId', coins: { $sum: { $subtract: ['$amount', '$used'] } } } },
            { $match: { coins: { $gte: Math.max(min, 1) } } },
        ]);
        return users(await activeCustomerIds(rows.map((r) => r._id)));
    }

    throw new ValidationError('Unknown audience type');
}

async function optedOutSet(targets) {
    if (!targets.length) return new Set();
    const rows = await NotificationPreference.find({
        marketingPush: false,
        ownerId: { $in: targets.map((t) => toOid(t.ownerId)) },
    })
        .select('ownerType ownerId')
        .lean();
    return new Set(rows.map((r) => `${r.ownerType}:${r.ownerId}`));
}

/** Live audience count for the builder. */
export async function previewAudience(audience = {}) {
    const normalized = normalizeAudience(audience);
    const targets = await resolveAudience(normalized);
    const opted = await optedOutSet(targets);
    const optedOut = targets.filter((t) => opted.has(`${t.ownerType}:${t.ownerId}`)).length;
    return { total: targets.length, optedOut, reachable: targets.length - optedOut };
}

// ---------------------------------------------------------------------------
// Campaign CRUD
// ---------------------------------------------------------------------------

function normalizeAudience(raw = {}) {
    const type = String(raw.type || '').trim();
    if (!AUDIENCE_TYPES.includes(type)) throw new ValidationError(`audience.type must be one of ${AUDIENCE_TYPES.join(', ')}`);
    const out = { type, zoneIds: [], channel: 'any', days: 30, minCoins: 0 };
    if (type === 'zone') {
        out.zoneIds = (Array.isArray(raw.zoneIds) ? raw.zoneIds : []).map((z) => toOid(z, 'zone id'));
        if (!out.zoneIds.length) throw new ValidationError('Pick at least one zone');
    }
    if (type === 'channel') {
        out.channel = ['quick', 'shop', 'any'].includes(raw.channel) ? raw.channel : 'any';
    }
    if (type === 'channel' || type === 'inactive') {
        const days = Number(raw.days);
        if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ValidationError('days must be a whole number from 1 to 3650');
        out.days = days;
    }
    if (type === 'coin_balance') {
        const min = Number(raw.minCoins);
        if (!Number.isFinite(min) || min < 1) throw new ValidationError('minCoins must be at least 1');
        out.minCoins = Math.floor(min);
    }
    return out;
}

export function buildDeepLink(deepLink = {}) {
    const type = DEEP_LINK_TYPES.includes(deepLink.type) ? deepLink.type : 'none';
    const value = String(deepLink.value || '').trim();
    const enc = encodeURIComponent(value);
    if (['product', 'category', 'store'].includes(type) && !value) throw new ValidationError(`Enter the ${type} to open`);
    switch (type) {
        case 'product': return `/product/${enc}`;
        case 'category': return `/category/${enc}`;
        case 'store': return `/sellers/${enc}`;
        case 'offer': return value ? `/offers?code=${enc}` : '/offers';
        case 'spin': return '/?spin=1';
        default: return '';
    }
}

function normalizeSchedule(raw = {}, now = new Date()) {
    const type = ['now', 'once', 'recurring'].includes(raw.type) ? raw.type : 'now';
    const date = (v, field) => {
        if (v === undefined || v === null || v === '') return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} is not a valid date`);
        return d;
    };
    const out = { type, sendAt: null, frequency: 'daily', timeOfDay: '10:00', daysOfWeek: [], startsAt: null, endsAt: null };
    if (type === 'once') {
        out.sendAt = date(raw.sendAt, 'schedule.sendAt');
        if (!out.sendAt) throw new ValidationError('Pick when to send');
    }
    if (type === 'recurring') {
        out.frequency = raw.frequency === 'weekly' ? 'weekly' : 'daily';
        if (toMinutes(raw.timeOfDay) === null) throw new ValidationError('timeOfDay must be HH:mm');
        out.timeOfDay = raw.timeOfDay;
        out.daysOfWeek = [...new Set((Array.isArray(raw.daysOfWeek) ? raw.daysOfWeek : []).map(Number))]
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        if (out.frequency === 'weekly' && !out.daysOfWeek.length) throw new ValidationError('Pick at least one day of the week');
        out.startsAt = date(raw.startsAt, 'schedule.startsAt');
        out.endsAt = date(raw.endsAt, 'schedule.endsAt');
        if (!out.endsAt) throw new ValidationError('A recurring campaign needs an end date');
        if (out.endsAt <= (out.startsAt || now)) throw new ValidationError('End date must be in the future and after the start');
    }
    return out;
}

/** status, nextRunAt and runKey for a freshly (re)scheduled campaign. */
function planFirstRun(schedule, now = new Date()) {
    if (schedule.type === 'now') return { status: 'scheduled', nextRunAt: now, runKey: 'once' };
    if (schedule.type === 'once') return { status: 'scheduled', nextRunAt: schedule.sendAt, runKey: 'once' };
    const next = nextOccurrence(schedule, new Date(now.getTime() - 1));
    if (!next) throw new ValidationError('This schedule has no send time before its end date');
    return { status: 'scheduled', nextRunAt: next, runKey: runKeyFor(schedule, next) };
}

function normalizeBody(body = {}, now = new Date()) {
    const title = String(body.title || '').trim();
    const message = String(body.message || '').trim();
    if (!title) throw new ValidationError('title is required');
    if (!message) throw new ValidationError('message is required');
    if (title.length > 120) throw new ValidationError('title is too long (120 max)');
    if (message.length > 500) throw new ValidationError('message is too long (500 max)');
    const deepLink = {
        type: DEEP_LINK_TYPES.includes(body.deepLink?.type) ? body.deepLink.type : 'none',
        value: String(body.deepLink?.value || '').trim(),
    };
    return {
        title,
        message,
        imageUrl: String(body.imageUrl || '').trim(),
        audience: normalizeAudience(body.audience || {}),
        deepLink,
        link: buildDeepLink(deepLink),
        schedule: normalizeSchedule(body.schedule || {}, now),
    };
}

/** Wakes the sender: a BullMQ job when Redis is there, otherwise in-process. */
export async function kickCampaignSender() {
    try {
        const { getQueue } = await import('../../../../queues/index.js');
        const { MAINTENANCE_QUEUE } = await import('../../../../queues/queue.constants.js');
        const queue = getQueue(MAINTENANCE_QUEUE);
        if (queue) {
            await queue.add('PUSH_CAMPAIGN_TICK', { type: 'PUSH_CAMPAIGN_TICK' }, { removeOnComplete: true });
            return 'queued';
        }
    } catch (err) {
        logger.warn(`Push campaign enqueue failed, sending in-process: ${err?.message || err}`);
    }
    if (String(process.env.PUSH_CAMPAIGNS_INLINE || 'true') === 'false') return 'deferred';
    setImmediate(() => {
        processDueCampaigns().catch((err) => logger.error(`Push campaign sweep failed: ${err?.message || err}`));
    });
    return 'inline';
}

const openRateOf = (stats = {}) => {
    const sent = Number(stats?.sent) || 0;
    return sent > 0 ? Math.round(((Number(stats?.opened) || 0) / sent) * 1000) / 10 : 0;
};
const withLabels = (c) => ({ ...c, audienceLabel: audienceLabel(c.audience), openRate: openRateOf(c.stats) });

function audienceLabel(a = {}) {
    switch (a.type) {
        case 'all_customers': return 'All customers';
        case 'zone': return `Customers in ${a.zoneIds?.length || 0} zone(s)`;
        case 'channel': return `Ordered in ${a.channel === 'quick' ? 'Quick' : a.channel === 'shop' ? 'Shop' : 'Quick or Shop'} in last ${a.days} days`;
        case 'inactive': return `Inactive for ${a.days}+ days`;
        case 'never_ordered': return 'Never ordered';
        case 'coin_balance': return `Coin balance ≥ ${a.minCoins}`;
        case 'sellers': return 'Sellers';
        case 'riders': return 'Riders';
        default: return a.type || '';
    }
}

export async function createPushCampaign(body = {}, adminId = null, now = new Date()) {
    const data = normalizeBody(body, now);
    const draft = body.draft === true;
    const plan = draft ? { status: 'draft', nextRunAt: null, runKey: '' } : planFirstRun(data.schedule, now);
    const campaign = await PushCampaign.create({
        ...data,
        ...plan,
        createdBy: adminId && mongoose.Types.ObjectId.isValid(String(adminId)) ? toOid(adminId) : null,
    });
    if (!draft && plan.nextRunAt <= now) await kickCampaignSender();
    return withLabels(campaign.toObject());
}

export async function updatePushCampaign(id, body = {}, now = new Date()) {
    const campaign = await PushCampaign.findById(toOid(id, 'campaign id'));
    if (!campaign) throw new NotFoundError('Campaign not found');
    if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
        throw new ValidationError(`A ${campaign.status} campaign cannot be edited`);
    }
    if (campaign.runCount > 0 && campaign.schedule?.type !== 'recurring') {
        throw new ValidationError('This campaign has already been sent');
    }
    const merged = {
        title: body.title ?? campaign.title,
        message: body.message ?? campaign.message,
        imageUrl: body.imageUrl ?? campaign.imageUrl,
        audience: body.audience ?? campaign.audience?.toObject?.() ?? campaign.audience,
        deepLink: body.deepLink ?? campaign.deepLink?.toObject?.() ?? campaign.deepLink,
        schedule: body.schedule ?? campaign.schedule?.toObject?.() ?? campaign.schedule,
    };
    const data = normalizeBody(merged, now);
    Object.assign(campaign, data);
    if (campaign.status === 'scheduled' || (campaign.status === 'draft' && body.draft === false)) {
        Object.assign(campaign, planFirstRun(data.schedule, now));
    }
    await campaign.save();
    if (campaign.status === 'scheduled' && campaign.nextRunAt <= now) await kickCampaignSender();
    return withLabels(campaign.toObject());
}

export async function setPushCampaignState(id, action, now = new Date()) {
    const _id = toOid(id, 'campaign id');
    const campaign = await PushCampaign.findById(_id).lean();
    if (!campaign) throw new NotFoundError('Campaign not found');
    if (action === 'pause') {
        const res = await PushCampaign.updateOne({ _id, status: { $in: ['scheduled', 'sending'] } }, { $set: { status: 'paused' } });
        if (!res.modifiedCount) throw new ValidationError(`A ${campaign.status} campaign cannot be paused`);
    } else if (action === 'resume') {
        if (campaign.status !== 'paused' && campaign.status !== 'draft') throw new ValidationError(`A ${campaign.status} campaign cannot be resumed`);
        const set = { status: 'scheduled' };
        if (!campaign.nextRunAt || campaign.status === 'draft') {
            Object.assign(set, planFirstRun(campaign.schedule, now));
        } else if (campaign.schedule?.type === 'recurring' && campaign.schedule.endsAt && campaign.nextRunAt > campaign.schedule.endsAt) {
            set.status = 'completed';
        }
        await PushCampaign.updateOne({ _id }, { $set: set });
        if (set.status === 'scheduled' && new Date(set.nextRunAt || campaign.nextRunAt) <= now) await kickCampaignSender();
    } else if (action === 'cancel') {
        const res = await PushCampaign.updateOne(
            { _id, status: { $in: ['draft', 'scheduled', 'sending', 'paused'] } },
            { $set: { status: 'cancelled', nextRunAt: null } },
        );
        if (!res.modifiedCount) throw new ValidationError(`A ${campaign.status} campaign cannot be cancelled`);
    } else {
        throw new ValidationError('Unknown action');
    }
    return getPushCampaign(id);
}

export async function deletePushCampaign(id) {
    const _id = toOid(id, 'campaign id');
    const campaign = await PushCampaign.findOneAndDelete({ _id, status: { $ne: 'sending' } }).lean();
    if (!campaign) throw new ValidationError('Campaign not found, or it is sending right now (pause it first)');
    await PushCampaignDelivery.deleteMany({ campaignId: _id });
    return { deleted: true };
}

export async function getPushCampaign(id) {
    const campaign = await PushCampaign.findById(toOid(id, 'campaign id')).populate('createdBy', 'name email').lean();
    if (!campaign) throw new NotFoundError('Campaign not found');
    return withLabels(campaign);
}

export async function listPushCampaigns({ page = 1, limit = 20, status } = {}) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.max(1, Math.min(100, Number(limit) || 20));
    const query = {};
    if (status && status !== 'all') query.status = String(status);
    const [items, total] = await Promise.all([
        PushCampaign.find(query).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).select('-runs').lean(),
        PushCampaign.countDocuments(query),
    ]);
    return {
        items: items.map(withLabels),
        pagination: { page: p, limit: l, total, totalPages: Math.max(1, Math.ceil(total / l)) },
    };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Campaigns due now, plus runs whose worker died mid-send. */
export async function selectDueCampaigns(now = new Date()) {
    return PushCampaign.find({
        $or: [
            { status: 'scheduled', nextRunAt: { $ne: null, $lte: now } },
            { status: 'sending', heartbeatAt: { $lt: new Date(now.getTime() - STALE_RUN_MS) } },
        ],
    })
        .sort({ nextRunAt: 1 })
        .select('_id')
        .lean();
}

async function refreshStats(campaignId, runKey, startedAt) {
    const rows = await PushCampaignDelivery.aggregate([
        { $match: { campaignId } },
        {
            $group: {
                _id: { runKey: '$runKey', status: '$status' },
                n: { $sum: 1 },
                opened: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$openedAt', null] }, null] }, 1, 0] } },
            },
        },
    ]);
    const total = { targeted: 0, sent: 0, failed: 0, skipped: 0, opened: 0 };
    const run = { targeted: 0, sent: 0, failed: 0, skipped: 0, opened: 0 };
    for (const r of rows) {
        for (const bucket of r._id.runKey === runKey ? [total, run] : [total]) {
            bucket.targeted += r.n;
            bucket.opened += r.opened || 0;
            if (bucket[r._id.status] !== undefined) bucket[r._id.status] += r.n;
        }
    }
    await PushCampaign.updateOne({ _id: campaignId }, { $set: { stats: total }, $pull: { runs: { runKey } } });
    await PushCampaign.updateOne(
        { _id: campaignId },
        { $push: { runs: { $each: [{ runKey, startedAt, finishedAt: new Date(), ...run }], $slice: -60 } } },
    );
    return { total, run };
}

async function sendOne(campaign, delivery, { optedOut, settings, now }) {
    const key = `${delivery.ownerType}:${delivery.ownerId}`;
    const finish = (status, reason = '', extra = {}) =>
        PushCampaignDelivery.updateOne({ _id: delivery._id, status: 'processing' }, { $set: { status, reason, ...extra } });

    if (optedOut.has(key)) return finish('skipped', 'opted_out');

    const localDay = localParts(now).dayKey;
    if (settings.dailyCap > 0) {
        const today = await PushCampaignDelivery.countDocuments({
            ownerType: delivery.ownerType,
            ownerId: delivery.ownerId,
            localDay,
            status: 'sent',
        });
        if (today >= settings.dailyCap) return finish('skipped', 'frequency_cap');
    }

    const result = await pushSender(
        { ownerType: delivery.ownerType, ownerId: String(delivery.ownerId) },
        {
            title: campaign.title,
            body: campaign.message,
            ...(campaign.imageUrl ? { image: campaign.imageUrl } : {}),
            data: {
                type: 'marketing_campaign',
                campaignId: String(campaign._id),
                // Generic open-tracking fields, read the same way by every client.
                deliveryId: String(delivery._id),
                openToken: openTokenFor(delivery._id),
                deepLink: campaign.link || '',
                link: campaign.link || '',
                deepLinkType: campaign.deepLink?.type || 'none',
                deepLinkValue: campaign.deepLink?.value || '',
            },
        },
    );
    if (Number(result?.successCount) > 0) return finish('sent', '', { localDay, sentAt: new Date() });
    const reason = result?.error ? String(result.error).slice(0, 200) : result?.results?.length === 0 ? 'no_device' : 'push_failed';
    return finish('failed', reason);
}

// ---------------------------------------------------------------------------
// Opens
// ---------------------------------------------------------------------------

const openSecret = () => `push-open:${process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev'}`;

/** The opaque proof, sent in the push, that a delivery id came from us. */
export function openTokenFor(deliveryId) {
    return crypto.createHmac('sha256', openSecret()).update(String(deliveryId)).digest('base64url');
}

const validOpenToken = (deliveryId, token) => {
    const expected = Buffer.from(openTokenFor(deliveryId));
    const given = Buffer.from(String(token || ''));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

/**
 * The person tapped a campaign push. Counted once per delivery; a forged or
 * replayed token counts nothing. `{ counted }` says whether this call counted it.
 */
export async function recordCampaignOpen({ deliveryId, openToken } = {}, now = new Date()) {
    const id = String(deliveryId || '');
    if (!mongoose.Types.ObjectId.isValid(id) || !validOpenToken(id, openToken)) {
        throw new ValidationError('Invalid notification');
    }
    const row = await PushCampaignDelivery.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(id), status: { $in: ['processing', 'sent'] }, openedAt: null },
        { $set: { openedAt: now } },
        { new: true },
    ).lean();
    if (!row) return { counted: false };
    await PushCampaign.updateOne(
        { _id: row.campaignId },
        { $inc: { 'stats.opened': 1, 'runs.$[r].opened': 1 } },
        { arrayFilters: [{ 'r.runKey': row.runKey }] },
    );
    return { counted: true };
}

/**
 * Sends one occurrence of a campaign. Safe to call again for the same runKey:
 * rows already sent (or skipped, or failed) are left alone.
 */
export async function runCampaignOccurrence(campaignId, runKey, { now = () => new Date(), settings: given } = {}) {
    const _id = toOid(campaignId, 'campaign id');
    const campaign = await PushCampaign.findById(_id).lean();
    if (!campaign) throw new NotFoundError('Campaign not found');
    const settings = given || (await getMarketingPushSettings());
    const startedAt = now();

    const quiet = quietHoursState(settings, startedAt);
    if (quiet.quiet) return { deferred: true, until: quiet.until };

    // Everyone in the audience gets one row for this run; re-running inserts nothing new.
    const targets = await resolveAudience(campaign.audience, startedAt);
    for (let i = 0; i < targets.length; i += 1000) {
        const chunk = targets.slice(i, i + 1000);
        await PushCampaignDelivery.bulkWrite(
            chunk.map((t) => ({
                updateOne: {
                    filter: { campaignId: _id, runKey, ownerType: t.ownerType, ownerId: toOid(t.ownerId) },
                    update: { $setOnInsert: { status: 'pending' } },
                    upsert: true,
                },
            })),
            { ordered: false },
        );
    }

    let batches = 0;
    for (;;) {
        const current = await PushCampaign.findById(_id).select('status').lean();
        if (!current || current.status !== 'sending') return { stopped: true, status: current?.status };
        const at = now();
        const q = quietHoursState(settings, at);
        if (q.quiet) return { deferred: true, until: q.until };

        const pending = await PushCampaignDelivery.find({ campaignId: _id, runKey, status: 'pending' })
            .limit(settings.batchSize)
            .lean();
        if (!pending.length) break;
        if (batches > 0 && settings.batchDelayMs > 0) await sleep(settings.batchDelayMs);
        batches += 1;

        // Take each row before sending it, so two runners never both send it.
        const claimed = [];
        for (const row of pending) {
            const res = await PushCampaignDelivery.updateOne({ _id: row._id, status: 'pending' }, { $set: { status: 'processing' } });
            if (res.modifiedCount) claimed.push(row);
        }
        const optedOut = await optedOutSet(claimed.map((r) => ({ ownerType: r.ownerType, ownerId: r.ownerId })));
        for (const row of claimed) {
            try {
                await sendOne(campaign, row, { optedOut, settings, now: at });
            } catch (err) {
                await PushCampaignDelivery.updateOne({ _id: row._id }, { $set: { status: 'failed', reason: String(err?.message || err).slice(0, 200) } });
            }
        }
        await PushCampaign.updateOne({ _id }, { $set: { heartbeatAt: new Date() } });
    }

    const stats = await refreshStats(_id, runKey, startedAt);
    return { done: true, batches, ...stats };
}

/** Claims a due campaign, sends its occurrence, and schedules the next one. */
export async function processCampaign(campaignId, { now = () => new Date(), settings } = {}) {
    const _id = toOid(campaignId, 'campaign id');
    const at = now();
    const claimed = await PushCampaign.findOneAndUpdate(
        {
            _id,
            $or: [
                { status: 'scheduled', nextRunAt: { $ne: null, $lte: at } },
                { status: 'sending', heartbeatAt: { $lt: new Date(at.getTime() - STALE_RUN_MS) } },
            ],
        },
        { $set: { status: 'sending', heartbeatAt: at } },
        { new: true },
    ).lean();
    if (!claimed) return { claimed: false };

    const runKey = claimed.runKey || runKeyFor(claimed.schedule, claimed.nextRunAt || at);
    // A run resumed after a crash: rows it had taken but not finished go back.
    await PushCampaignDelivery.updateMany({ campaignId: _id, runKey, status: 'processing' }, { $set: { status: 'pending' } });

    let result;
    try {
        result = await runCampaignOccurrence(_id, runKey, { now, settings });
    } catch (err) {
        await PushCampaign.updateOne({ _id, status: 'sending' }, { $set: { status: 'scheduled', nextRunAt: new Date(at.getTime() + 5 * 60 * 1000) } });
        throw err;
    }

    if (result.deferred) {
        await PushCampaign.updateOne({ _id, status: 'sending' }, { $set: { status: 'scheduled', nextRunAt: result.until, runKey } });
        return { claimed: true, ...result };
    }
    if (result.stopped) return { claimed: true, ...result };

    const next = nextOccurrence(claimed.schedule, new Date(Math.max(now().getTime(), new Date(claimed.nextRunAt || at).getTime())));
    const set = next
        ? { status: 'scheduled', nextRunAt: next, runKey: runKeyFor(claimed.schedule, next) }
        : { status: 'completed', nextRunAt: null };
    await PushCampaign.updateOne(
        { _id, status: 'sending' },
        { $set: { ...set, lastRunAt: at }, $inc: { runCount: 1 } },
    );
    return { claimed: true, ...result, next: next || null };
}

let sweeping = false;
/** The sweep: every due campaign, one at a time. Called every minute. */
export async function processDueCampaigns({ now = () => new Date() } = {}) {
    if (sweeping) return { skipped: true };
    sweeping = true;
    try {
        const due = await selectDueCampaigns(now());
        const results = [];
        for (const { _id } of due) {
            try {
                results.push({ campaignId: String(_id), ...(await processCampaign(_id, { now })) });
            } catch (err) {
                logger.error(`Push campaign ${_id} failed: ${err?.message || err}`);
                results.push({ campaignId: String(_id), error: err?.message || String(err) });
            }
        }
        return { processed: results.length, results };
    } finally {
        sweeping = false;
    }
}
