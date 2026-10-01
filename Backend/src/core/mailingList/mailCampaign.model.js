import mongoose from 'mongoose';

/** One newsletter send: what went out, to which list, and how it went. */
const mailCampaignSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 20000 },
    // Empty: every subscriber; otherwise only those who subscribed from it.
    source: { type: String, default: '' },
    status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending', index: true },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'platform_mail_campaigns' },
);

export const MailCampaign = mongoose.models.MailCampaign || mongoose.model('MailCampaign', mailCampaignSchema);
