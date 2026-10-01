import mongoose from 'mongoose';

/**
 * One email on the newsletter list, platform-wide: a person who subscribes
 * from the Food site and later from the Shop is one row with both sources,
 * and one unsubscribe link takes them off every list.
 */
export const MAIL_SOURCES = Object.freeze(['food', 'quick', 'shop', 'taxi', 'services', 'other']);

const mailSubscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 254 },
    sources: { type: [{ type: String, enum: MAIL_SOURCES }], default: [] },
    status: { type: String, enum: ['subscribed', 'unsubscribed'], default: 'subscribed', index: true },
    // Random and unguessable: the unsubscribe link carries only this.
    unsubscribeToken: { type: String, required: true, unique: true },
    subscribedAt: { type: Date, default: Date.now, index: true },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'platform_mail_subscribers' },
);

export const MailSubscriber = mongoose.models.MailSubscriber || mongoose.model('MailSubscriber', mailSubscriberSchema);
