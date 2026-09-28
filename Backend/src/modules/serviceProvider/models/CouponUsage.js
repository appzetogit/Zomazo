const mongoose = require('mongoose');

/**
 * One redemption of a Services coupon. The per-customer limit is counted from
 * these, and a booking's row is removed if the booking is cancelled before any
 * work, so an abandoned booking does not use up a customer's code.
 */
const couponUsageSchema = new mongoose.Schema({
  couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPCoupon', required: true, index: true },
  couponCode: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPUser', required: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPBooking', default: null, index: true },
  discount: { type: Number, default: 0, min: 0 }
}, {
  timestamps: true
});

couponUsageSchema.index({ couponId: 1, userId: 1 });

module.exports = mongoose.models.SPCouponUsage || mongoose.model('SPCouponUsage', couponUsageSchema, 'sp_coupon_usages');
