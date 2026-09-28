const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const { referralSummary } = require('../../services/referralService');

// The customer's own code and what sharing it pays right now.
router.get('/referral', authenticate, isUser, async (req, res) => {
  try {
    const data = await referralSummary(req.user.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

module.exports = router;
