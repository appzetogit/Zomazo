import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';
import { isModuleEnabled } from '../modules/moduleState.service.js';
import { MODULES } from '../modules/moduleRegistry.js';
import { resolveInviter } from './inviteCode.service.js';

/**
 * Invites redeemed at the platform sign-in (/login?ref=<code>&via=<service>).
 *
 * Every customer app now signs in on the one /login page, so every service's
 * invite link lands there. `via` says whose referral programme the code
 * belongs to:
 *   food  (default)  Food's programme -- core/auth/auth.service.js, as before
 *   taxi             Taxi's: referredBy on the shared account, the referrer's
 *                    count, and whatever its settings pay at sign-up (the
 *                    after-N-rides kinds pay later, off referredBy)
 *   shop             the Shop's, on its own customer rows (ecom_users), only
 *                    while its module is switched on
 *   quick            Quick & Medical's, on qc_users
 *   services         Services', on sp_users
 *
 * The code is the friend's one invite code, or any code a service handed out
 * before there was one (inviteCode.service.js); a friend with no row in the
 * service yet is given one, as their first visit would.
 *
 * Only a sign-in that creates the account redeems anything; the caller checks.
 * Never throws: a referral problem must not fail a sign-in.
 */

const ALIASES = {
  rides: 'taxi', ride: 'taxi', ecommerce: 'shop', ecom: 'shop',
  quickcommerce: 'quick', qc: 'quick', medical: 'quick',
  serviceprovider: 'services', sp: 'services', service: 'services',
};
export const REFERRAL_VIA = ['food', 'taxi', 'shop', 'quick', 'services'];

export const normalizeReferralVia = (value) => {
  const key = String(value || '').trim().toLowerCase();
  const via = ALIASES[key] || key;
  return REFERRAL_VIA.includes(via) ? via : 'food';
};

const isHexId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));

/**
 * The platform account an invite code names: its own code, or any code a
 * service handed out before there was one code (inviteCode.service.js).
 */
export const resolvePlatformReferrer = (ref) => resolveInviter(ref);

async function redeemTaxi({ userId, ref }) {
  const referrerId = await resolvePlatformReferrer(ref);
  if (!referrerId) return { credited: false, reason: 'unknown_referrer' };
  if (String(referrerId) === String(userId)) return { credited: false, reason: 'self_referral' };

  const { User: TaxiUser } = await import('../../modules/taxi/user/models/User.js');
  // Claimed, not read-then-written: only the first redemption for this account
  // sets referredBy, so a retried request cannot count or pay twice.
  const claimed = await TaxiUser.updateOne(
    { _id: userId, $or: [{ referredBy: null }, { referredBy: { $exists: false } }] },
    { $set: { referredBy: referrerId } },
  );
  if (claimed.modifiedCount !== 1) return { credited: false, reason: 'already_referred' };
  await TaxiUser.updateOne({ _id: referrerId }, { $inc: { referralCount: 1 } });

  const [{ processSignupReferralRewards }, user, referrer] = await Promise.all([
    import('../../modules/taxi/user/controllers/userController.js'),
    TaxiUser.findById(userId),
    TaxiUser.findById(referrerId),
  ]);
  if (!user || !referrer) return { credited: false, reason: 'unknown_referrer' };
  await processSignupReferralRewards({ user, referrer });
  return { credited: true };
}

async function redeemShop({ userId, ref }) {
  if (!(await isModuleEnabled(MODULES.ECOMMERCE))) return { credited: false, reason: 'shop_off' };
  const [{ ensureShopCustomer }, { creditShopSignupReferral }] = await Promise.all([
    import('../../modules/ecommerce/core/auth/auth.middleware.js'),
    import('../../modules/ecommerce/modules/commerce/user/services/userReferral.service.js'),
  ]);
  const refereeId = await ensureShopCustomer(userId);
  if (!refereeId) return { credited: false, reason: 'no_referee' };
  return creditShopSignupReferral({ refereeId, ref });
}

async function redeemQuick({ userId, ref }) {
  if (!(await isModuleEnabled(MODULES.QUICK_COMMERCE))) return { credited: false, reason: 'quick_off' };
  const [{ ensureQuickCustomer }, { creditQuickSignupReferral }] = await Promise.all([
    import('../../modules/quickCommerce/core/auth/auth.middleware.js'),
    import('../../modules/quickCommerce/core/auth/auth.service.js'),
  ]);
  const refereeId = await ensureQuickCustomer(userId);
  if (!refereeId) return { credited: false, reason: 'no_referee' };
  return creditQuickSignupReferral({ refereeId, ref });
}

async function redeemServices({ userId, ref }) {
  if (!(await isModuleEnabled(MODULES.SERVICE_PROVIDER))) return { credited: false, reason: 'services_off' };
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { resolveSharedCustomer } = require('../../modules/serviceProvider/utils/identityBridge.js');
  const { applyReferralAtSignup } = require('../../modules/serviceProvider/services/referralService.js');
  const referee = await resolveSharedCustomer(userId);
  if (!referee) return { credited: false, reason: 'no_referee' };
  const outcome = await applyReferralAtSignup({ refereeId: referee._id, refereePhone: referee.phone, code: ref });
  return { credited: outcome.status === 'credited', reason: outcome.reason || outcome.status };
}

/**
 * Redeem an invite for a brand-new platform account, in the programme `via`
 * names. Food's programme stays in core/auth/auth.service.js; this handles the
 * others.
 *
 * @param {{ userId: string, ref: string, via: 'taxi'|'shop'|'quick'|'services' }} input
 * @returns {Promise<{ credited: boolean, reason?: string }>}
 */
export async function redeemServiceInvite({ userId, ref, via } = {}) {
  try {
    const code = String(ref || '').trim();
    if (!code || !isHexId(userId)) return { credited: false, reason: 'no_referral' };
    if (via === 'taxi') return await redeemTaxi({ userId: new mongoose.Types.ObjectId(String(userId)), ref: code });
    if (via === 'shop') return await redeemShop({ userId: String(userId), ref: code });
    if (via === 'quick') return await redeemQuick({ userId: String(userId), ref: code });
    if (via === 'services') return await redeemServices({ userId: String(userId), ref: code });
    return { credited: false, reason: 'unknown_programme' };
  } catch (err) {
    logger.warn(`[referral] ${via} invite for ${userId} not redeemed: ${err.message}`);
    return { credited: false, reason: 'error' };
  }
}
