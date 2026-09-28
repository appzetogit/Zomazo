const mongoose = require('mongoose');

/**
 * One admin broadcast to the Services apps: what was sent, to whom, and how it
 * went. Sending happens after the admin's request returns (there can be tens
 * of thousands of devices), so the counts fill in as it runs and `status` says
 * when it is done.
 */
const broadcastSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  // A path in the receiving app to open on tap, e.g. /user/services.
  link: { type: String, trim: true, default: '' },
  audiences: [{ type: String, enum: ['customers', 'vendors', 'workers'] }],
  status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending', index: true },
  // Set by the one run that sends it, so a retry or a second server never sends twice.
  claimedAt: { type: Date, default: null },
  recipients: { type: Number, default: 0 },   // accounts reached (inbox rows written)
  devices: { type: Number, default: 0 },      // push tokens attempted
  delivered: { type: Number, default: 0 },    // FCM successes
  failedDevices: { type: Number, default: 0 },
  error: { type: String, default: '' },
  sentBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  finishedAt: { type: Date, default: null }
}, {
  timestamps: true
});

broadcastSchema.index({ createdAt: -1 });

module.exports = mongoose.models.SPBroadcast || mongoose.model('SPBroadcast', broadcastSchema, 'sp_broadcasts');
