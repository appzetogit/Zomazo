const mongoose = require('mongoose');

/**
 * A Services coupon, made by an admin.
 *
 * Field names follow the food and quick-commerce offers (couponCode,
 * discountType 'percentage' | 'flat-price', status 'active' | 'paused' |
 * 'inactive', ...) on purpose: Master > Coupons lists every service's coupons
 * with one row builder and pauses them by writing `status`, so a coupon shaped
 * like the others needs no special case there.
 *
 * The platform funds the discount. Partners are paid on the service's base
 * price (see the bill), so a coupon never comes out of a vendor's share.
 */
const couponSchema = new mongoose.Schema({
  couponCode: {
    type: String,
    required: [true, 'Please provide a coupon code'],
    trim: true,
    uppercase: true,
    unique: true,
    match: [/^[A-Z0-9_-]{3,20}$/, 'Code must be 3-20 letters, digits, - or _']
  },
  title: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  discountType: { type: String, enum: ['percentage', 'flat-price'], default: 'percentage' },
  discountValue: { type: Number, required: true, min: 0.01 },
  // Cap on a percentage discount; null for none.
  maxDiscount: { type: Number, default: null, min: 0 },
  minOrderValue: { type: Number, default: 0, min: 0 },
  // Total redemptions across all customers; null for unlimited.
  usageLimit: { type: Number, default: null, min: 1 },
  usedCount: { type: Number, default: 0, min: 0 },
  perUserLimit: { type: Number, default: 1, min: 1 },
  // 'first-time': only a customer with no earlier Services booking.
  customerScope: { type: String, enum: ['all', 'first-time'], default: 'all' },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['active', 'paused', 'inactive'], default: 'active', index: true },
  // Listed to customers at checkout; a hidden code still works when typed.
  showInCart: { type: Boolean, default: true },
  createdByRole: { type: String, default: 'ADMIN' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, default: null }
}, {
  timestamps: true
});

couponSchema.pre('validate', function checkPercentage(next) {
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    this.invalidate('discountValue', 'A percentage discount cannot be over 100');
  }
  if (this.startDate && this.endDate && this.endDate <= this.startDate) {
    this.invalidate('endDate', 'The end date must be after the start date');
  }
  next();
});

// A code another service's coupon holds is refused. The registry is ESM, so
// it is loaded when first needed (core/promotions/couponCodeRegistry.js).
const loadCouponRegistry = () => import('../../../core/promotions/couponCodeRegistry.js');
couponSchema.pre('validate', async function checkCouponCode() {
  if (!this.isNew && !this.isModified('couponCode')) return;
  const { assertCouponCodeFree } = await loadCouponRegistry();
  await assertCouponCodeFree(this.couponCode, 'sp_coupons');
});
couponSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], async function checkCouponCodeUpdate() {
  const update = this.getUpdate() || {};
  const code = update.couponCode ?? update.$set?.couponCode;
  if (code === undefined) return;
  const { assertCouponCodeFree } = await loadCouponRegistry();
  await assertCouponCodeFree(code, 'sp_coupons');
});

module.exports = mongoose.models.SPCoupon || mongoose.model('SPCoupon', couponSchema, 'sp_coupons');
