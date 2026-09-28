const mongoose = require('mongoose');
const Coupon = require('../../models/Coupon');
const CouponUsage = require('../../models/CouponUsage');

/**
 * Admin CRUD for Services coupons (Admin > Coupons in the Services panel).
 * Checking and redeeming a code at booking time is couponService's job.
 */

// Only these fields are taken from the form: usedCount and createdBy are the
// server's, and an admin editing a coupon must not be able to reset its count.
const EDITABLE = [
  'couponCode', 'title', 'description', 'discountType', 'discountValue', 'maxDiscount',
  'minOrderValue', 'usageLimit', 'perUserLimit', 'customerScope', 'startDate', 'endDate',
  'status', 'showInCart'
];

const pickEditable = (body = {}) => {
  const out = {};
  for (const key of EDITABLE) {
    if (body[key] === undefined) continue;
    // An emptied optional field in the form arrives as '' and means "none".
    out[key] = body[key] === '' && ['maxDiscount', 'usageLimit', 'startDate', 'endDate'].includes(key)
      ? null
      : body[key];
  }
  if (typeof out.couponCode === 'string') out.couponCode = out.couponCode.trim().toUpperCase();
  return out;
};

const badRequest = (res, error) => {
  if (error?.code === 11000) {
    return res.status(400).json({ success: false, message: 'A coupon with this code already exists' });
  }
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    const first = error.errors ? Object.values(error.errors)[0] : null;
    return res.status(400).json({ success: false, message: first?.message || error.message });
  }
  return null;
};

exports.getAllCoupons = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (['active', 'paused', 'inactive'].includes(status)) filter.status = status;
    if (search && String(search).trim()) {
      const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ couponCode: new RegExp(safe, 'i') }, { title: new RegExp(safe, 'i') }];
    }
    const coupons = await Coupon.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, count: coupons.length, data: coupons });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

exports.getCoupon = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    const coupon = await Coupon.findById(req.params.id).lean();
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const recentUses = await CouponUsage.find({ couponId: coupon._id })
      .sort({ createdAt: -1 }).limit(20)
      .populate('userId', 'name phone')
      .populate('bookingId', 'bookingNumber finalAmount status')
      .lean();
    res.status(200).json({ success: true, data: { ...coupon, recentUses } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

exports.createCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.create({
      ...pickEditable(req.body),
      createdByRole: 'ADMIN',
      createdBy: mongoose.Types.ObjectId.isValid(req.user?.id) ? req.user.id : null
    });
    res.status(201).json({ success: true, data: coupon });
  } catch (error) {
    if (badRequest(res, error)) return;
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

exports.updateCoupon = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    // Loaded and saved rather than findByIdAndUpdate so the schema's cross-field
    // checks (percentage <= 100, end after start) run on the edited whole.
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    coupon.set(pickEditable(req.body));
    await coupon.save();
    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    if (badRequest(res, error)) return;
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

exports.toggleCouponStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    coupon.status = coupon.status === 'active' ? 'paused' : 'active';
    await coupon.save();
    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    if (badRequest(res, error)) return;
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    // A used coupon is kept (switched off) so bookings that carry its code still
    // point at something; an unused one is simply removed.
    const used = await CouponUsage.exists({ couponId: coupon._id });
    if (used) {
      coupon.status = 'inactive';
      await coupon.save();
      return res.status(200).json({ success: true, message: 'Coupon has been used, so it was switched off instead of deleted', data: coupon });
    }
    await coupon.deleteOne();
    res.status(200).json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
};
