const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

/*
 * Since the sp_users merge the customer IS their platform account (the profile,
 * models/User.js, has the same _id), and the Services referral fields live on
 * that account under sp* names: spReferralCode (the SPxxxxxx code people
 * already hold), spReferredBy and spReferralCount -- so they never touch Food's.
 */
const accounts = () => mongoose.connection.collection('users');
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const ReferralLog = require('../models/ReferralLog');
const Transaction = require('../models/Transaction');

/**
 * Services referrals: a customer shares their code; when someone new signs up
 * to the Services app with it, the referrer's wallet is credited.
 *
 * What it pays comes from Master > Referral (the Services tab, else "All
 * services"). Services has no referral screen of its own, so with nothing set
 * in Master there is no reward -- 0 in either box switches it off. Paid at
 * sign-up, as Food does, with the same guards: never for one's own code, once
 * per phone number ever, and no more than the per-customer limit.
 */

const VERTICAL = 'serviceProvider';

/** Master's reward and limit for Services; 0 for anything not set. */
async function referralTerms() {
  const { resolveMasterReferral } = await import('../../../core/referral/referralSettings.service.js');
  const m = await resolveMasterReferral(VERTICAL);
  return { reward: Number(m.customerReward) || 0, limit: Number(m.customerLimit) || 0 };
}

const newCode = () => `SP${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;

/** The customer's code, made on first ask. Retries on the rare collision. */
async function ensureReferralCode(userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId || ''))) return null;
  const existing = await accounts().findOne({ _id: oid(userId) }, { projection: { spReferralCode: 1 } });
  if (!existing) return null;
  if (existing.spReferralCode) return existing.spReferralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    // Unique by look-up: the account collection has no unique index on it.
    if (await accounts().findOne({ spReferralCode: code }, { projection: { _id: 1 } })) continue;
    await accounts().updateOne(
      { _id: oid(userId), $or: [{ spReferralCode: null }, { spReferralCode: { $exists: false } }] },
      { $set: { spReferralCode: code } }
    );
    // Ours, or someone else's set in between; theirs stands.
    return (await accounts().findOne({ _id: oid(userId) }, { projection: { spReferralCode: 1 } }))?.spReferralCode || null;
  }
  throw new Error('Could not make a referral code');
}

/**
 * The friend a code names, as a Services customer: their own SP code, else any
 * code the platform knows them by (one code per person,
 * core/referral/inviteCode.service.js), giving them a Services record if they
 * have none. Null when no one matches.
 */
async function findReferrer(code) {
  const referralCode = String(code || '').trim().toUpperCase();
  if (!referralCode) return null;
  const owner = await accounts().findOne({ spReferralCode: referralCode }, { projection: { _id: 1 } });
  const own = owner ? await User.findById(owner._id).select('_id phone name').lean() : null;
  if (own) return own;
  const { resolveInviter } = await import('../../../core/referral/inviteCode.service.js');
  const platformId = await resolveInviter(String(code).trim());
  if (!platformId) return null;
  const { resolveSharedCustomer } = require('../utils/identityBridge');
  const row = await resolveSharedCustomer(String(platformId));
  return row ? { _id: row._id, phone: row.phone, name: row.name } : null;
}

/** The code to share: the person's one platform code, else this record's own. */
async function shareCode(userId) {
  const { inviteCodeForRow } = await import('../../../core/referral/inviteCode.service.js');
  return (await inviteCodeForRow('users', String(userId)).catch(() => null)) || ensureReferralCode(userId);
}

async function referralSummary(userId) {
  const [code, terms, user] = await Promise.all([
    shareCode(userId),
    referralTerms(),
    mongoose.Types.ObjectId.isValid(String(userId || '')) ? accounts().findOne({ _id: oid(userId) }, { projection: { spReferralCount: 1 } }) : null
  ]);
  return {
    code,
    reward: terms.reward,
    limit: terms.limit,
    rewarded: Number(user?.spReferralCount) || 0,
    active: terms.reward > 0 && terms.limit > 0
  };
}

/**
 * A new customer signed up with `code`. Records who referred them and pays
 * the referrer when every rule allows it. Never throws: a referral problem must
 * not fail a sign-up. Returns what happened, for the caller's logs and tests.
 */
async function applyReferralAtSignup({ refereeId, refereePhone, code }) {
  const referralCode = String(code || '').trim().toUpperCase();
  if (!referralCode) return { status: 'none' };
  try {
    const referrer = await findReferrer(code);
    if (!referrer) return { status: 'unknown_code' };
    if (String(referrer._id) === String(refereeId) || (refereePhone && referrer.phone === refereePhone)) {
      return { status: 'self' };
    }

    // Who referred them is kept whatever the reward, for reporting.
    await accounts().updateOne(
      { _id: oid(refereeId), $or: [{ spReferredBy: null }, { spReferredBy: { $exists: false } }] },
      { $set: { spReferredBy: oid(referrer._id) } }
    );

    const reject = async (reason) => {
      await ReferralLog.create({ referrerId: referrer._id, refereeId, refereePhone, status: 'rejected', reason });
      return { status: 'rejected', reason };
    };

    const { reward, limit } = await referralTerms();
    if (!(reward > 0)) return reject('reward_disabled');
    if (!(limit > 0)) return reject('limit_disabled');
    if (await ReferralLog.exists({ refereePhone, status: 'credited' })) return reject('phone_already_rewarded');

    // One reward per person across every service. The claim register is ESM
    // (core/referral/referralClaim.service.js), loaded when first needed.
    const { claimReferralForPhone, releaseReferralClaim } = await import('../../../core/referral/referralClaim.service.js');
    const platformClaim = await claimReferralForPhone({ phone: refereePhone, programme: 'serviceProvider', referrerId: referrer._id, refereeId });
    if (!platformClaim.claimed) return reject('rewarded_in_other_service');

    // Claim a slot under the limit atomically: two sign-ups at once cannot both
    // take the last one.
    const claimed = await accounts().updateOne(
      { _id: oid(referrer._id), $or: [{ spReferralCount: { $lt: limit } }, { spReferralCount: { $exists: false } }] },
      { $inc: { spReferralCount: 1 } }
    );
    if (claimed.modifiedCount !== 1) {
      await releaseReferralClaim({ phone: refereePhone, programme: 'serviceProvider' });
      return reject('limit_reached');
    }

    // Through the shared-wallet bridge: a linked customer is credited in their
    // one platform wallet, anyone else on their Services balance.
    const credited = await User.findOneAndUpdate(
      { _id: referrer._id },
      { $inc: { 'wallet.balance': reward } },
      { new: true }
    ).lean();
    await Transaction.create({
      userId: referrer._id,
      type: 'credit',
      amount: reward,
      status: 'completed',
      paymentMethod: 'system',
      description: 'Referral reward',
      balanceAfter: Number(credited?.wallet?.balance) || 0,
      metadata: { kind: 'referral', refereeId: String(refereeId) }
    });
    await ReferralLog.create({ referrerId: referrer._id, refereeId, refereePhone, reward, status: 'credited' });

    try {
      const { createNotification } = require('../controllers/notificationControllers/notificationController');
      await createNotification({
        userId: referrer._id,
        type: 'referral_reward',
        title: 'Referral reward',
        message: `₹${reward} added to your wallet: someone joined with your code.`,
        relatedType: 'user',
        data: { amount: reward }
      });
    } catch (err) {
      console.warn('[Referral] Reward notification not sent:', err.message);
    }
    return { status: 'credited', reward, referrerId: referrer._id };
  } catch (err) {
    console.error('[Referral] Sign-up referral failed:', err.message);
    return { status: 'error', reason: err.message };
  }
}

module.exports = {
  VERTICAL,
  referralTerms,
  ensureReferralCode,
  referralSummary,
  findReferrer,
  applyReferralAtSignup
};
