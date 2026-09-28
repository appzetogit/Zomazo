const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const User = require('../../models/User');
const Booking = require('../../models/Booking');
const { referralSummary, applyReferralAtSignup } = require('../../services/referralService');

/*
 * A customer signed in on the platform never goes through the Services sign-up,
 * which is where a referral code used to be taken -- so a friend's code had no
 * way in. They can enter it here instead, once, while they are new to Services
 * (no code used yet and no booking made). The reward rules are the sign-up
 * ones: never one's own code, once per phone number, within the limit.
 */
const canApplyCode = async (userId) => {
  const user = await User.findById(userId).select('referredBy').lean();
  if (!user || user.referredBy) return false;
  return !(await Booking.exists({ userId }));
};

// The customer's own code and what sharing it pays right now.
router.get('/referral', authenticate, isUser, async (req, res) => {
  try {
    const [data, canApply] = await Promise.all([referralSummary(req.user.id), canApplyCode(req.user.id)]);
    res.status(200).json({ success: true, data: { ...data, canApplyCode: canApply } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// A friend's code, entered by a customer new to Services.
router.post('/referral/apply', authenticate, isUser, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: 'Enter a referral code' });

    const referrer = await User.findOne({ referralCode: code }).select('_id phone').lean();
    if (!referrer) return res.status(400).json({ success: false, message: 'That referral code is not valid' });
    if (String(referrer._id) === String(req.user.id) || (req.user.phone && referrer.phone === req.user.phone)) {
      return res.status(400).json({ success: false, message: 'You cannot use your own code' });
    }
    if (await Booking.exists({ userId: req.user.id })) {
      return res.status(400).json({ success: false, message: 'Referral codes are for customers who have not booked yet' });
    }

    // Claimed first and atomically, so two requests at once cannot both apply a code.
    const claimed = await User.updateOne({ _id: req.user.id, referredBy: null }, { $set: { referredBy: referrer._id } });
    if (claimed.modifiedCount !== 1) {
      return res.status(400).json({ success: false, message: 'You have already used a referral code' });
    }

    const outcome = await applyReferralAtSignup({ refereeId: req.user.id, refereePhone: req.user.phone, code });
    const rewarded = outcome.status === 'credited';
    res.status(200).json({
      success: true,
      message: rewarded ? 'Code applied. Your friend has been rewarded.' : 'Code applied.',
      data: { applied: true, referrerRewarded: rewarded }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

module.exports = router;
