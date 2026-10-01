import crypto from 'crypto';
import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { PayoutAccount } from './payoutAccount.model.js';
import { getPayoutKind, PAYOUT_KINDS } from './payoutKinds.js';
import {
    isPayoutConfigured,
    createContact,
    createFundAccount,
    createPayout,
    fetchPayout,
    pickMode,
    PayoutApiError,
} from './razorpayx.client.js';

/*
 * Bank payouts for approved withdrawals, through RazorpayX.
 *
 * The admin still approves a withdrawal exactly as before -- balance check,
 * decided once, money taken from the payee. "Pay via bank" then sends that
 * approved amount to the account on file. Without RazorpayX configured none of
 * this runs and the admin keeps marking requests paid by hand.
 *
 * Each withdrawal row carries a `payout` sub-document:
 *
 *   initiating -> processing -> processed            (money arrived, UTR kept)
 *            \            \--> failed / reversed     (money returned, request reopened)
 *
 * Every step is one conditional update on the row, so a double click, two
 * admins, a retried webhook and the status sync can all race and only one of
 * them moves it. A failed or reversed payout puts the request back to PENDING
 * and gives the payee back what approval took, in one transaction -- the
 * claim on the payout state is what makes that refund happen exactly once.
 * "Retry" is then simply approving and paying again, with every original guard.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATES = ['initiating', 'processing'];

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const toId = (id) => {
    if (!mongoose.Types.ObjectId.isValid(String(id))) throw httpError(400, 'Invalid withdrawal ID');
    return new mongoose.Types.ObjectId(String(id));
};

const amountOf = (kind, record) => Math.round(Number(kind.amountOf ? kind.amountOf(record) : record.amount || 0) * 100) / 100;

const fingerprintOf = (account) => crypto
    .createHash('sha256')
    .update(account.vpa ? `vpa:${account.vpa.toLowerCase()}` : `bank:${account.ifsc}:${account.number}`)
    .digest('hex');

const refEmpty = (field) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });

/*
 * Payouts go only to the account on file, and not within 24 hours of it
 * changing. Riders' profiles stamp bankDetailsChangedAt; for everyone else the
 * account row notices the change -- details that differ from the ones last
 * paid -- and the day is counted from when it first noticed.
 */
const checkAccountHold = async (payee, fingerprint) => {
    const now = Date.now();
    if (payee.changedAt && new Date(payee.changedAt).getTime() + DAY_MS > now) {
        throw httpError(409, 'Payout details changed in the last 24 hours. Bank payouts open again a day after the change.');
    }
    const row = await PayoutAccount.findOne({ payeeType: payee.payeeType, payeeId: payee.payeeId }).lean();
    if (!row?.fingerprint || row.fingerprint === fingerprint) return row;

    let seenAt = row.pendingFingerprint === fingerprint ? row.changeSeenAt : null;
    if (!seenAt) {
        seenAt = new Date(now);
        await PayoutAccount.updateOne({ _id: row._id }, { $set: { pendingFingerprint: fingerprint, changeSeenAt: seenAt } });
    }
    if (new Date(seenAt).getTime() + DAY_MS > now) {
        throw httpError(409, 'Payout details changed since the last payout. Bank payouts open again a day after the change.');
    }
    return row;
};

/** Reuse the payee's contact; reuse the fund account only while it still points at the account on file. */
const ensureFundAccount = async (payee, fingerprint, row) => {
    let contactId = row?.contactId;
    if (!contactId) {
        const contact = await createContact({
            name: payee.name,
            email: payee.email,
            phone: payee.phone,
            type: payee.contactType,
            referenceId: `${payee.payeeType}:${payee.payeeId}`,
        });
        contactId = contact.id;
        // Kept at once, so a fund-account failure below does not make a second contact next time.
        await PayoutAccount.updateOne(
            { payeeType: payee.payeeType, payeeId: payee.payeeId },
            { $set: { contactId } },
            { upsert: true },
        );
    }
    if (row?.fundAccountId && row.fingerprint === fingerprint) return row.fundAccountId;

    const fund = await createFundAccount({ contactId, account: payee.account });
    await PayoutAccount.updateOne(
        { payeeType: payee.payeeType, payeeId: payee.payeeId },
        {
            $set: { contactId, fundAccountId: fund.id, fingerprint },
            $unset: { pendingFingerprint: 1, changeSeenAt: 1 },
        },
        { upsert: true },
    );
    return fund.id;
};

/** RazorpayX's payout status, in our words. */
const stateFor = (status) => {
    if (status === 'processed') return 'processed';
    if (status === 'reversed') return 'reversed';
    if (['failed', 'rejected', 'cancelled'].includes(status)) return 'failed';
    return 'processing';
};

/**
 * Return the money and reopen the request -- once. The claim (the payout still
 * open, or processed for a reversal, and still THIS payout) and the refund
 * commit together, so a second webhook, a sync and a refresh landing at once
 * find nothing left to claim.
 */
const failPayout = async (kindKey, id, { payoutId = null, state = 'failed', reason = '' }) => {
    const kind = getPayoutKind(kindKey);
    const Model = await kind.model();
    const now = new Date();
    const session = await mongoose.startSession();
    let reopened = null;
    try {
        await session.withTransaction(async () => {
            reopened = null;
            const filter = {
                _id: id,
                status: kind.approvedStatus,
                'payout.state': { $in: state === 'reversed' ? [...OPEN_STATES, 'processed'] : OPEN_STATES },
                ...(payoutId ? { 'payout.payoutId': payoutId } : {}),
            };
            const claimed = await Model.collection.findOneAndUpdate(
                filter,
                {
                    $set: {
                        status: 'pending',
                        'payout.state': state,
                        'payout.failureReason': String(reason || '').slice(0, 300),
                        'payout.refundedAt': now,
                        'payout.updatedAt': now,
                    },
                    $unset: { processedAt: 1, processedDate: 1 },
                },
                { session, returnDocument: 'after', includeResultMetadata: false },
            );
            if (!claimed) return;
            await kind.refund({ record: claimed, amount: Number(claimed.amount || 0), session });
            reopened = claimed;
        });
    } finally {
        await session.endSession();
    }
    if (reopened) logger.info(`[Payouts] ${kindKey} ${id} ${state}: returned to the payee and reopened (${reason})`);
    return reopened;
};

/** Apply a payout entity from RazorpayX (webhook, refresh or sync) to its withdrawal. */
export const applyPayoutUpdate = async (kindKey, recordId, payout) => {
    const kind = getPayoutKind(kindKey);
    const Model = await kind.model();
    const id = toId(recordId);
    const next = stateFor(payout?.status);
    const reason = payout?.status_details?.description || payout?.failure_reason || payout?.status || '';

    if (next === 'failed' || next === 'reversed') {
        return failPayout(kindKey, id, { payoutId: payout.id, state: next, reason });
    }

    const now = new Date();
    const utr = payout.utr || null;
    if (next === 'processed') {
        const done = await Model.collection.findOneAndUpdate(
            { _id: id, 'payout.payoutId': payout.id, 'payout.state': { $in: OPEN_STATES } },
            { $set: { 'payout.state': 'processed', 'payout.utr': utr, 'payout.paidAt': now, 'payout.updatedAt': now } },
            { returnDocument: 'after', includeResultMetadata: false },
        );
        // The existing screens and partner apps show the manual reference field.
        if (done && utr) {
            await Model.collection.updateOne({ _id: id, ...refEmpty(kind.refField) }, { $set: { [kind.refField]: utr } });
        }
        return done;
    }
    return Model.collection.findOneAndUpdate(
        { _id: id, 'payout.payoutId': payout.id, 'payout.state': { $in: OPEN_STATES } },
        { $set: { 'payout.state': 'processing', 'payout.providerStatus': payout.status, 'payout.updatedAt': now } },
        { returnDocument: 'after', includeResultMetadata: false },
    );
};

/*
 * Send the payout for a claimed row. Safe to call again for the same attempt:
 * the idempotency key makes RazorpayX hand back the payout it already made.
 */
const sendPayout = async (kindKey, record) => {
    const kind = getPayoutKind(kindKey);
    const Model = await kind.model();
    const p = record.payout;
    const key = `${record._id}-${p.attempt}`;
    try {
        const payout = await createPayout({
            fundAccountId: p.fundAccountId,
            amountRupees: p.amount,
            mode: p.mode,
            referenceId: key,
            narration: 'ZOMAZO payout',
            notes: { kind: kindKey, recordId: String(record._id), attempt: String(p.attempt) },
            idempotencyKey: key,
        });
        await Model.collection.updateOne(
            { _id: record._id, 'payout.state': 'initiating', 'payout.attempt': p.attempt },
            { $set: { 'payout.payoutId': payout.id, 'payout.state': 'processing', 'payout.updatedAt': new Date() }, $unset: { 'payout.lastError': 1 } },
        );
        return applyPayoutUpdate(kindKey, record._id, payout);
    } catch (err) {
        if (err instanceof PayoutApiError && err.definitive) {
            return failPayout(kindKey, record._id, { state: 'failed', reason: err.message });
        }
        // Unknown outcome: stay 'initiating' so refresh / sync re-sends with the same key.
        await Model.collection.updateOne(
            { _id: record._id, 'payout.state': 'initiating' },
            { $set: { 'payout.lastError': String(err.message).slice(0, 300), 'payout.updatedAt': new Date() } },
        );
        throw httpError(502, `Bank payout could not be confirmed yet: ${err.message}. Use Refresh to check again.`);
    }
};

/**
 * "Pay via bank" for one approved withdrawal. Refuses -- without touching
 * anything -- when payouts are off, the row is not approved, it already has a
 * manual reference, a payout is under way, or the payee's account is on hold.
 */
export const initiatePayout = async (kindKey, recordId, { adminId = null } = {}) => {
    if (!isPayoutConfigured()) throw httpError(400, 'Bank payouts are not set up. Mark the withdrawal paid by hand.');
    const kind = getPayoutKind(kindKey);
    const Model = await kind.model();
    const id = toId(recordId);

    const record = await Model.collection.findOne({ _id: id });
    if (!record) throw httpError(404, 'Withdrawal request not found');
    if (record.status !== kind.approvedStatus) throw httpError(409, 'Approve the withdrawal before paying it');
    if (record[kind.refField]) throw httpError(409, 'This withdrawal is already marked paid by hand');
    if (record.payout?.state && record.payout.state !== 'failed' && record.payout.state !== 'reversed') {
        throw httpError(409, `A bank payout for this withdrawal is already ${record.payout.state}`);
    }

    const amount = amountOf(kind, record);
    if (!(amount > 0)) throw httpError(400, 'Nothing to pay on this withdrawal');
    const payee = await kind.payee(record);
    if (!payee) throw httpError(404, 'Payee not found');
    if (!payee.account) throw httpError(400, 'No bank account or UPI id on file for this payee');

    const fingerprint = fingerprintOf(payee.account);
    const row = await checkAccountHold(payee, fingerprint);

    let fundAccountId;
    try {
        fundAccountId = await ensureFundAccount(payee, fingerprint, row);
    } catch (err) {
        throw httpError(err.definitive ? 400 : 502, `Bank account could not be registered: ${err.message}`);
    }

    // The claim: approved, unpaid, no live payout. A second click finds it taken.
    const now = new Date();
    const claimed = await Model.collection.findOneAndUpdate(
        {
            _id: id,
            status: kind.approvedStatus,
            $and: [
                refEmpty(kind.refField),
                { $or: [{ 'payout.state': { $exists: false } }, { 'payout.state': { $in: [null, 'failed', 'reversed'] } }] },
            ],
        },
        {
            $set: {
                'payout.state': 'initiating',
                'payout.provider': 'razorpayx',
                'payout.amount': amount,
                'payout.mode': pickMode({ amountRupees: amount, isVpa: !!payee.account.vpa }),
                'payout.fundAccountId': fundAccountId,
                'payout.payoutId': null,
                'payout.utr': null,
                'payout.failureReason': null,
                'payout.initiatedBy': adminId ? String(adminId) : null,
                'payout.initiatedAt': now,
                'payout.updatedAt': now,
            },
            $inc: { 'payout.attempt': 1 },
        },
        { returnDocument: 'after', includeResultMetadata: false },
    );
    if (!claimed) throw httpError(409, 'A bank payout for this withdrawal was just started');

    const result = await sendPayout(kindKey, claimed);
    return result || Model.collection.findOne({ _id: id });
};

/** Ask RazorpayX where a payout stands, or re-send one whose creation never got an answer. */
export const refreshPayout = async (kindKey, recordId) => {
    if (!isPayoutConfigured()) throw httpError(400, 'Bank payouts are not set up');
    const kind = getPayoutKind(kindKey);
    const Model = await kind.model();
    const id = toId(recordId);
    const record = await Model.collection.findOne({ _id: id });
    if (!record?.payout) throw httpError(404, 'No bank payout on this withdrawal');

    if (record.payout.state === 'initiating' && !record.payout.payoutId) {
        await sendPayout(kindKey, record);
    } else if (record.payout.payoutId && OPEN_STATES.includes(record.payout.state)) {
        try {
            await applyPayoutUpdate(kindKey, id, await fetchPayout(record.payout.payoutId));
        } catch (err) {
            throw httpError(502, `Could not read the payout from RazorpayX: ${err.message}`);
        }
    }
    return Model.collection.findOne({ _id: id });
};

/**
 * Webhook body -> withdrawal. The payout's notes name the kind and row; the
 * payout id in the update filter makes a stale event for an older attempt a
 * no-op.
 */
export const handlePayoutWebhook = async (body) => {
    const event = String(body?.event || '');
    const payout = body?.payload?.payout?.entity;
    if (!event.startsWith('payout.') || !payout?.id) return { handled: false };
    const kindKey = payout.notes?.kind;
    const recordId = payout.notes?.recordId;
    if (!PAYOUT_KINDS[kindKey] || !mongoose.Types.ObjectId.isValid(String(recordId))) return { handled: false };
    await applyPayoutUpdate(kindKey, recordId, payout);
    return { handled: true };
};

/**
 * Payouts with no news for a while: re-ask RazorpayX. Webhooks can be lost;
 * this keeps a payout from sitting in "processing" forever.
 */
export const syncStuckPayouts = async ({ olderThanMs = 10 * 60 * 1000 } = {}) => {
    if (!isPayoutConfigured()) return 0;
    const cutoff = new Date(Date.now() - olderThanMs);
    let touched = 0;
    for (const kindKey of Object.keys(PAYOUT_KINDS)) {
        const Model = await PAYOUT_KINDS[kindKey].model();
        const stuck = await Model.collection
            .find({ 'payout.state': { $in: OPEN_STATES }, 'payout.updatedAt': { $lt: cutoff } })
            .project({ _id: 1 })
            .limit(50)
            .toArray();
        for (const row of stuck) {
            try {
                await refreshPayout(kindKey, row._id);
                touched += 1;
            } catch (err) {
                logger.warn(`[Payouts] sync ${kindKey} ${row._id}: ${err.message}`);
            }
        }
    }
    return touched;
};

export const startPayoutSync = () => {
    if (!isPayoutConfigured()) return null;
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            await syncStuckPayouts();
        } catch (err) {
            logger.error(`[Payouts] sync failed: ${err.message}`);
        } finally {
            busy = false;
        }
    };
    logger.info('Bank payout status sync scheduled (every 15 minutes)');
    return setInterval(tick, 15 * 60 * 1000);
};

export { isPayoutConfigured };
