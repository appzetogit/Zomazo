import crypto from 'crypto';
import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { getSellerTimezone } from '../../../../utils/timezone.js';
import { creditCoins, getCoinBalance } from '../../coins/services/coin.service.js';
import { SpinCampaign, SpinResult, SpinBudget, DEFAULT_SPIN_SEGMENTS } from '../models/spin.model.js';

const toOid = (id, what = 'id') => {
    const s = String(id || '');
    if (!mongoose.Types.ObjectId.isValid(s)) throw new ValidationError(`Invalid ${what}`);
    return new mongoose.Types.ObjectId(s);
};

/**
 * The store's calendar day, not the server's: a server on UTC would otherwise
 * reset everyone's daily spin at 5:30 in the morning in India.
 */
const storeDay = (at = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: getSellerTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** When the store's next day begins, as a real instant. */
function nextStoreDayStart(at = new Date()) {
    const today = storeDay(at);
    // Step forward in hours until the store-local date changes; at most 25 steps.
    let t = new Date(Math.floor(at.getTime() / 3600000) * 3600000);
    while (storeDay(t) === today) t = new Date(t.getTime() + 3600000);
    return t;
}

/** Where a campaign sits in its schedule window: 'scheduled', 'live' or 'ended'. */
export function scheduleStatus(campaign, now = new Date()) {
    const t = now.getTime();
    if (campaign?.startsAt && t < new Date(campaign.startsAt).getTime()) return 'scheduled';
    if (campaign?.endsAt && t >= new Date(campaign.endsAt).getTime()) return 'ended';
    return 'live';
}

/**
 * The wheel customers see, or null when an admin has switched every wheel off.
 * A default wheel is created only the first time, when there is none at all.
 */
export async function getActiveCampaign(now = new Date()) {
    const campaign = await SpinCampaign.findOne({ isActive: true }).lean();
    if (campaign) return scheduleStatus(campaign, now) === 'live' ? campaign : null;
    if (await SpinCampaign.exists({})) return null;
    try {
        return (await SpinCampaign.create({
            title: 'Daily Lucky Wheel',
            isActive: true,
            segments: DEFAULT_SPIN_SEGMENTS,
            dailyLimit: 1,
        })).toObject();
    } catch {
        return SpinCampaign.findOne({ isActive: true }).lean();
    }
}

export async function getSpinStatus(userId) {
    const user = toOid(userId, 'user id');
    const campaign = await getActiveCampaign();
    if (!campaign) return { canSpin: false, spinsRemaining: 0, dailyLimit: 0, nextSpinAt: null, segments: [], isActive: false };
    const spinsToday = await SpinResult.countDocuments({ userId: user, day: storeDay() });
    const dailyLimit = campaign.dailyLimit || 1;
    const coinBalance = await getCoinBalance(user).catch(() => ({ usable: 0 }));

    return {
        canSpin: spinsToday < dailyLimit,
        spinsRemaining: Math.max(0, dailyLimit - spinsToday),
        dailyLimit,
        nextSpinAt: nextStoreDayStart(),
        segments: campaign.segments,
        coinBalance: coinBalance.usable,
        isActive: true,
    };
}

function pickSegmentIndex(segments) {
    const weights = segments.map((s) => Math.max(1, Number(s.weight) || 1));
    const total = weights.reduce((a, b) => a + b, 0);
    // Chosen on the server with a CSPRNG; the app only animates to the answer.
    const roll = crypto.randomInt(0, total);
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
        cumulative += weights[i];
        if (roll < cumulative) return i;
    }
    return weights.length - 1;
}

/**
 * Takes `coins` from this month's budget, or returns false if it would go over.
 * The check and the draw-down are one conditional update.
 */
async function drawFromBudget(campaign, coins, at = new Date()) {
    const budget = Number(campaign.monthlyCoinBudget) || 0;
    if (budget <= 0) return true;
    const month = storeDay(at).slice(0, 7);
    await SpinBudget.updateOne(
        { campaignId: campaign._id, month },
        { $setOnInsert: { used: 0 } },
        { upsert: true }
    ).catch((err) => { if (err?.code !== 11000) throw err; });
    const res = await SpinBudget.updateOne(
        { campaignId: campaign._id, month, used: { $lte: budget - coins } },
        { $inc: { used: coins } }
    );
    return res.modifiedCount === 1;
}

/**
 * One spin. The daily limit is enforced by claiming a numbered slot for the
 * store-local day under a unique index, so rapid or scripted taps cannot spin
 * more than the limit. The result is recorded before any coins move, and the
 * credit is keyed to the spin, so a retry never pays twice.
 */
export async function playSpin(userId, { ip = '' } = {}) {
    const user = toOid(userId, 'user id');
    const campaign = await getActiveCampaign();
    if (!campaign) throw new ValidationError('The wheel is not running right now');
    const dailyLimit = campaign.dailyLimit || 1;
    const day = storeDay();
    const segments = campaign.segments?.length ? campaign.segments : DEFAULT_SPIN_SEGMENTS;

    let index = pickSegmentIndex(segments);
    let segment = segments[index];

    // Over budget: land on a no-prize segment rather than pay out.
    if (segment.type === 'coins' && segment.value > 0 && !(await drawFromBudget(campaign, segment.value))) {
        const blank = segments.findIndex((s) => s.type === 'none');
        index = blank >= 0 ? blank : index;
        segment = blank >= 0 ? segments[blank] : { ...segment, type: 'none', value: 0, label: 'Better Luck' };
    }

    const spinId = new mongoose.Types.ObjectId();
    const pays = segment.type === 'coins' && segment.value > 0;
    let result = null;
    const taken = await SpinResult.countDocuments({ userId: user, day });
    for (let seq = taken + 1; seq <= dailyLimit && !result; seq++) {
        try {
            result = await SpinResult.create({
                _id: spinId,
                userId: user,
                campaignId: campaign._id,
                segmentWon: { id: segment.id, label: segment.label, type: segment.type, value: segment.value },
                rewardRef: pays ? `spin:${spinId}` : null,
                coinsAwarded: pays ? segment.value : 0,
                ip,
                day,
                seq,
            });
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // Another spin took this slot a moment ago; try the next one.
        }
    }
    if (!result) {
        // Give back any budget drawn for a spin that never happened.
        if (pays && Number(campaign.monthlyCoinBudget) > 0) {
            await SpinBudget.updateOne({ campaignId: campaign._id, month: day.slice(0, 7) }, { $inc: { used: -segment.value } });
        }
        throw new ValidationError('You have already used your daily spin. Come back tomorrow!');
    }

    if (pays) {
        try {
            await creditCoins({
                userId: user,
                amount: segment.value,
                source: 'spin',
                refId: `spin:${spinId}`,
                spendablePercent: 100,
                note: `Won on ${campaign.title || 'the wheel'} (${segment.label})`,
            });
            await SpinResult.updateOne({ _id: spinId }, { $set: { rewardStatus: 'credited' } });
        } catch (err) {
            logger.error(`[spin] crediting ${segment.value} coins for spin ${spinId} failed: ${err?.message || err}`);
            await SpinResult.updateOne({ _id: spinId }, { $set: { rewardStatus: 'failed' } });
            throw err;
        }
    }

    const balance = await getCoinBalance(user).catch(() => ({ usable: 0 }));
    return {
        winningIndex: index,
        segment,
        coinsAwarded: pays ? segment.value : 0,
        balance: balance.usable,
        spinsRemaining: Math.max(0, dailyLimit - result.seq),
    };
}

// ---- admin -----------------------------------------------------------------

const SEGMENT_TYPES = ['coins', 'none'];

function cleanSegments(raw) {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) {
        throw new ValidationError('A wheel needs between 2 and 12 segments');
    }
    return raw.map((seg, i) => {
        const type = SEGMENT_TYPES.includes(seg?.type) ? seg.type : null;
        if (!type) throw new ValidationError(`Segment ${i + 1}: type must be coins or none`);
        const value = type === 'coins' ? Math.floor(Number(seg.value)) : 0;
        if (type === 'coins' && !(value > 0)) throw new ValidationError(`Segment ${i + 1}: coins must be a positive whole number`);
        const weight = Math.floor(Number(seg.weight));
        if (!(weight >= 1)) throw new ValidationError(`Segment ${i + 1}: weight must be at least 1`);
        const label = String(seg.label || '').trim() || (type === 'coins' ? `${value} Coins` : 'Better Luck');
        return { id: i + 1, label, type, value, weight, color: String(seg.color || '').trim() || '#6b7280' };
    });
}

function cleanCampaign(body = {}, { partial = false } = {}) {
    const out = {};
    if (!partial || body.title !== undefined) {
        const title = String(body.title || '').trim();
        if (!title) throw new ValidationError('Title is required');
        out.title = title;
    }
    if (!partial || body.segments !== undefined) out.segments = cleanSegments(body.segments);
    if (body.dailyLimit !== undefined) {
        const n = Math.floor(Number(body.dailyLimit));
        if (!(n >= 1 && n <= 10)) throw new ValidationError('Daily limit must be between 1 and 10');
        out.dailyLimit = n;
    }
    if (body.monthlyCoinBudget !== undefined) {
        const n = Math.floor(Number(body.monthlyCoinBudget));
        if (!(n >= 0)) throw new ValidationError('Monthly budget must be 0 (no cap) or more');
        out.monthlyCoinBudget = n;
    }
    for (const key of ['startsAt', 'endsAt']) {
        if (body[key] === undefined) continue;
        if (body[key] === null || body[key] === '') { out[key] = null; continue; }
        const d = new Date(body[key]);
        if (Number.isNaN(d.getTime())) throw new ValidationError(`${key === 'startsAt' ? 'Start' : 'End'} time is not a valid date`);
        out[key] = d;
    }
    return out;
}

function assertWindow(startsAt, endsAt) {
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        throw new ValidationError('End time must be after start time');
    }
}

/** Each segment's chance, as the admin will see it before saving. */
const withChances = (campaign) => {
    const total = (campaign.segments || []).reduce((s, x) => s + Math.max(1, Number(x.weight) || 1), 0);
    return {
        ...campaign,
        startsAt: campaign.startsAt || null,
        endsAt: campaign.endsAt || null,
        scheduleStatus: scheduleStatus(campaign),
        segments: (campaign.segments || []).map((s) => ({
            ...s,
            chancePercent: total ? Math.round((Math.max(1, Number(s.weight) || 1) / total) * 1000) / 10 : 0,
        })),
    };
};

export async function listCampaigns() {
    const campaigns = await SpinCampaign.find({}).sort({ isActive: -1, updatedAt: -1 }).lean();
    return campaigns.map(withChances);
}

export async function createCampaign(body) {
    const clean = cleanCampaign(body);
    assertWindow(clean.startsAt, clean.endsAt);
    const doc = await SpinCampaign.create({ ...clean, isActive: false });
    return withChances(doc.toObject());
}

export async function updateCampaign(id, body) {
    const oid = toOid(id, 'campaign id');
    const clean = cleanCampaign(body, { partial: true });
    if (clean.startsAt !== undefined || clean.endsAt !== undefined) {
        const existing = await SpinCampaign.findById(oid).lean();
        if (!existing) throw new ValidationError('Campaign not found');
        assertWindow(clean.startsAt !== undefined ? clean.startsAt : existing.startsAt, clean.endsAt !== undefined ? clean.endsAt : existing.endsAt);
    }
    const doc = await SpinCampaign.findByIdAndUpdate(oid, { $set: clean }, { new: true }).lean();
    if (!doc) throw new ValidationError('Campaign not found');
    return withChances(doc);
}

/** Only one wheel runs at a time: switching one on switches the others off. */
export async function setCampaignActive(id, isActive) {
    const oid = toOid(id, 'campaign id');
    if (isActive) await SpinCampaign.updateMany({ _id: { $ne: oid } }, { $set: { isActive: false } });
    const doc = await SpinCampaign.findByIdAndUpdate(oid, { $set: { isActive: Boolean(isActive) } }, { new: true }).lean();
    if (!doc) throw new ValidationError('Campaign not found');
    return withChances(doc);
}

/** A month of spins: how many, what they paid, and against what budget. */
export async function getSpinReport({ month } = {}) {
    const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : storeDay().slice(0, 7);
    const days = { $regex: `^${m}-` };
    const [totals] = await SpinResult.aggregate([
        { $match: { day: days } },
        {
            $group: {
                _id: null,
                spins: { $sum: 1 },
                players: { $addToSet: '$userId' },
                coinsAwarded: { $sum: '$coinsAwarded' },
                failedCredits: { $sum: { $cond: [{ $eq: ['$rewardStatus', 'failed'] }, 1, 0] } },
            },
        },
    ]);
    const bySegment = await SpinResult.aggregate([
        { $match: { day: days } },
        { $group: { _id: '$segmentWon.label', wins: { $sum: 1 }, coins: { $sum: '$coinsAwarded' } } },
        { $sort: { wins: -1 } },
    ]);
    const active = await SpinCampaign.findOne({ isActive: true }).lean();
    const budget = active ? await SpinBudget.findOne({ campaignId: active._id, month: m }).lean() : null;
    return {
        month: m,
        spins: totals?.spins || 0,
        players: totals?.players?.length || 0,
        coinsAwarded: totals?.coinsAwarded || 0,
        failedCredits: totals?.failedCredits || 0,
        budget: active ? { limit: active.monthlyCoinBudget || 0, used: budget?.used || 0 } : null,
        bySegment: bySegment.map((s) => ({ label: s._id, wins: s.wins, coins: s.coins })),
    };
}
