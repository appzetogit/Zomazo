const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const couponService = require('../../services/couponService');

/*
 * Coupons at checkout. Listing and checking are previews: nothing is used up
 * until a booking is created with the code (userBookingController).
 */

const publicView = (c) => ({
  _id: c._id,
  couponCode: c.couponCode,
  title: c.title,
  description: c.description,
  discountType: c.discountType,
  discountValue: c.discountValue,
  maxDiscount: c.maxDiscount,
  minOrderValue: c.minOrderValue,
  customerScope: c.customerScope,
  endDate: c.endDate
});

router.get('/coupons', authenticate, isUser, async (req, res) => {
  try {
    const coupons = await couponService.listAvailableCoupons(req.user.id);
    res.status(200).json({ success: true, data: coupons.map(publicView) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

router.post('/coupons/validate', authenticate, isUser, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: 'Booking amount is required' });
    }
    const { coupon, discount } = await couponService.validateCoupon({
      code: req.body?.code,
      userId: req.user.id,
      amount
    });
    res.status(200).json({ success: true, data: { coupon: publicView(coupon), discount } });
  } catch (error) {
    if (error instanceof couponService.CouponError) {
      return res.status(400).json({ success: false, code: 'COUPON_INVALID', message: error.message });
    }
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

module.exports = router;
