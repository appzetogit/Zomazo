const mongoose = require('mongoose');

/**
 * Every Services referral attempt, paid or not, and why. The "already rewarded
 * for this phone" rule is read from here, so a customer who deletes their
 * account and signs up again with the same number cannot earn their referrer
 * a second reward.
 */
const referralLogSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPUser', required: true, index: true },
  refereeId: { type: mongoose.Schema.Types.ObjectId, ref: 'SPUser', required: true },
  refereePhone: { type: String, required: true, index: true },
  reward: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['credited', 'rejected'], required: true },
  reason: { type: String, default: '' }
}, {
  timestamps: true
});

module.exports = mongoose.models.SPReferralLog || mongoose.model('SPReferralLog', referralLogSchema, 'sp_referral_logs');
