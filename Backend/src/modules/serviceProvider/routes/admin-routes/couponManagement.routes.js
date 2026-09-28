const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getAllCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  toggleCouponStatus,
  deleteCoupon
} = require('../../controllers/adminControllers/couponController');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }
  return next();
};

const optionalNumber = (field, min, message) =>
  body(field).optional({ values: 'falsy' }).isFloat({ min }).withMessage(message);

const couponRules = (creating) => [
  (creating ? body('couponCode') : body('couponCode').optional())
    .trim()
    .notEmpty().withMessage('Coupon code is required')
    .matches(/^[A-Za-z0-9_-]{3,20}$/).withMessage('Code must be 3-20 letters, digits, - or _'),
  body('discountType').optional().isIn(['percentage', 'flat-price']).withMessage('Discount type must be percentage or flat-price'),
  (creating ? body('discountValue') : body('discountValue').optional())
    .isFloat({ gt: 0 }).withMessage('Discount value must be more than 0'),
  optionalNumber('maxDiscount', 0, 'Max discount must be 0 or more'),
  optionalNumber('minOrderValue', 0, 'Minimum booking value must be 0 or more'),
  body('usageLimit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Total uses must be at least 1'),
  body('perUserLimit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Uses per customer must be at least 1'),
  body('customerScope').optional().isIn(['all', 'first-time']).withMessage('Audience must be all or first-time'),
  body('status').optional().isIn(['active', 'paused', 'inactive']).withMessage('Invalid status'),
  body('startDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid start date'),
  body('endDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid end date'),
  body('showInCart').optional().isBoolean().withMessage('showInCart must be true or false'),
  validate
];

router.get('/coupons', authenticate, isAdmin, getAllCoupons);
router.get('/coupons/:id', authenticate, isAdmin, getCoupon);
router.post('/coupons', authenticate, isAdmin, couponRules(true), createCoupon);
router.put('/coupons/:id', authenticate, isAdmin, couponRules(false), updateCoupon);
router.patch('/coupons/:id/status', authenticate, isAdmin, toggleCouponStatus);
router.delete('/coupons/:id', authenticate, isAdmin, deleteCoupon);

module.exports = router;
