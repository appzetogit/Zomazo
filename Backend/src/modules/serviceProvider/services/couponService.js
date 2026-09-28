const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');

/**
 * Services coupons: checking a code, pricing its discount, and counting its use.
 *
 * Checked on the server at booking time. Before this, createBooking took
 * `promoCode` and `promoDiscount` from the app as given and then let the price
 * floor overrule them, so a code either did nothing or was whatever the app said.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normalizeCode = (code) => String(code || '').trim().toUpperCase();

class CouponError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CouponError';
    this.statusCode = 400;
  }
}

/** The discount a coupon gives on this amount, never more than the amount. */
function discountFor(coupon, amount) {
  const base = Math.max(0, Number(amount) || 0);
  const value = Number(coupon.discountValue) || 0;
  let discount = coupon.discountType === 'flat-price' ? value : (base * value) / 100;
  if (coupon.discountType !== 'flat-price' && Number(coupon.maxDiscount) > 0) {
    discount = Math.min(discount, Number(coupon.maxDiscount));
  }
  return round2(Math.min(discount, base));
}

/** Why this coupon cannot be used right now, regardless of who asks; null when it can. */
function unavailableReason(coupon, now = new Date()) {
  if (!coupon || coupon.status !== 'active') return 'This coupon is not active';
  if (coupon.startDate && new Date(coupon.startDate) > now) return 'This coupon is not active yet';
  if (coupon.endDate && new Date(coupon.endDate) <= now) return 'This coupon has expired';
  if (coupon.usageLimit != null && (coupon.usedCount || 0) >= coupon.usageLimit) return 'This coupon has been fully used';
  return null;
}

/**
 * Check a code for this customer and amount. Returns { coupon, discount } or
 * throws a CouponError whose message can be shown to the customer.
 *
 * @param {object} args
 * @param {string} args.code
 * @param {string} args.userId  the SP user
 * @param {number} args.amount  what the coupon applies to (service value, tax and visiting charges)
 */
async function validateCoupon({ code, userId, amount }) {
  const couponCode = normalizeCode(code);
  if (!couponCode) throw new CouponError('Enter a coupon code');
  const coupon = await Coupon.findOne({ couponCode }).lean();
  if (!coupon) throw new CouponError('This coupon code is not valid');

  const reason = unavailableReason(coupon);
  if (reason) throw new CouponError(reason);

  if (Number(amount) < (Number(coupon.minOrderValue) || 0)) {
    throw new CouponError(`This coupon needs a booking of at least ₹${coupon.minOrderValue}`);
  }

  if (userId) {
    const used = await CouponUsage.countDocuments({ couponId: coupon._id, userId });
    if (used >= (Number(coupon.perUserLimit) || 1)) {
      throw new CouponError('You have already used this coupon');
    }
    if (coupon.customerScope === 'first-time') {
      // Required lazily: Booking requires this module's neighbours at load time.
      const Booking = require('../models/Booking');
      const { BOOKING_STATUS } = require('../utils/constants');
      const earlier = await Booking.exists({ userId, status: { $ne: BOOKING_STATUS.CANCELLED } });
      if (earlier) throw new CouponError('This coupon is for your first booking only');
    }
  }

  const discount = discountFor(coupon, amount);
  if (!(discount > 0)) throw new CouponError('This coupon gives no discount on this booking');
  return { coupon, discount };
}

/**
 * Take one use of the coupon. Atomic against the total limit: two customers
 * racing for the last use cannot both get it. Returns false when it is gone.
 */
async function claimCoupon(coupon) {
  const filter = { _id: coupon._id, status: 'active' };
  if (coupon.usageLimit != null) filter.usedCount = { $lt: coupon.usageLimit };
  const res = await Coupon.updateOne(filter, { $inc: { usedCount: 1 } });
  return res.modifiedCount === 1;
}

/** Give back a use taken by claimCoupon (the booking it was for was never made). */
async function unclaimCoupon(couponId) {
  await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

async function recordUsage({ coupon, userId, bookingId, discount }) {
  return CouponUsage.create({
    couponId: coupon._id,
    couponCode: coupon.couponCode,
    userId,
    bookingId,
    discount
  });
}

/**
 * A booking cancelled before any work gives its coupon back, both the
 * customer's use and the total count. Best effort: a failure here must not fail
 * the cancellation, which has already happened.
 */
async function releaseCouponForBooking(bookingId) {
  try {
    const usage = await CouponUsage.findOneAndDelete({ bookingId });
    if (usage) await unclaimCoupon(usage.couponId);
    return Boolean(usage);
  } catch (err) {
    console.error(`[Coupon] Could not release the coupon of booking ${bookingId}:`, err.message);
    return false;
  }
}

/** Coupons a customer can see at checkout: live, listed, and not used up. */
async function listAvailableCoupons(userId) {
  const now = new Date();
  const coupons = await Coupon.find({
    status: 'active',
    showInCart: true,
    $and: [
      { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: null }, { endDate: { $gt: now } }] }
    ]
  }).sort({ createdAt: -1 }).limit(50).lean();

  const open = coupons.filter((c) => !unavailableReason(c, now));
  if (!userId || !open.length) return open;
  const usage = await CouponUsage.aggregate([
    { $match: { userId: new (require('mongoose').Types.ObjectId)(String(userId)), couponId: { $in: open.map((c) => c._id) } } },
    { $group: { _id: '$couponId', n: { $sum: 1 } } }
  ]);
  const usedBy = new Map(usage.map((u) => [String(u._id), u.n]));
  return open.filter((c) => (usedBy.get(String(c._id)) || 0) < (Number(c.perUserLimit) || 1));
}

module.exports = {
  CouponError,
  normalizeCode,
  discountFor,
  unavailableReason,
  validateCoupon,
  claimCoupon,
  unclaimCoupon,
  recordUsage,
  releaseCouponForBooking,
  listAvailableCoupons
};
