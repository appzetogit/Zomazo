/**
 * Services' link to the platform's rewards (core/promotions): loyalty points
 * and cashback on a completed booking, and the wallet bonus on a top-up.
 *
 * Completion happens in several places (worker, vendor, cash collection,
 * online payment), so each calls rewardCompletedBooking; the core pays once per
 * booking however many of them run.
 *
 * Only for customers with a platform account. The rewards land in the one
 * wallet (food_user_wallets); a Services customer without a platform account
 * keeps their balance on their Services record (utils/sharedWalletBridge.js),
 * where money credited to the one wallet would never be seen.
 *
 * Neither function throws or blocks: a reward must not fail a booking or a
 * top-up.
 */

const core = (p) => import(`../../../core/${p}`);

const platformAccountOf = async (customerId) => {
  const { platformUserIdFor } = await core('identity/platformUser.js');
  const found = await platformUserIdFor(String(customerId || '')).catch(() => null);
  return found?.platformId || null;
};

async function rewardCompletedBooking(booking) {
  try {
    if (!booking?._id || !booking.userId) return null;
    if (String(booking.status) !== 'completed') return null;
    if (!(await platformAccountOf(booking.userId))) return null;
    const { rewardCompletedOrder } = await core('promotions/orderRewards.js');
    return await rewardCompletedOrder({
      service: 'serviceProvider',
      customerId: booking.userId,
      orderId: booking._id,
      orderDisplayId: booking.bookingNumber || '',
      amount: Number(booking.finalAmount) || 0,
    });
  } catch (err) {
    console.warn(`[SP] booking rewards failed for ${booking?._id}: ${err?.message || err}`);
    return null;
  }
}

async function applyTopupBonus({ customerId, topupAmount, reference }) {
  try {
    if (!(await platformAccountOf(customerId))) return 0;
    const { applyTopupBonus: apply } = await core('promotions/walletBonus.service.js');
    return await apply({ customerId, topupAmount, reference, service: 'serviceProvider' });
  } catch (err) {
    console.warn(`[SP] wallet bonus failed for top-up ${reference}: ${err?.message || err}`);
    return 0;
  }
}

module.exports = { rewardCompletedBooking, applyTopupBonus };
