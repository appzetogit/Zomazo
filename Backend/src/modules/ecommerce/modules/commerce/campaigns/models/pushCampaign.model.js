import mongoose from 'mongoose';

export const AUDIENCE_TYPES = ['all_customers', 'zone', 'channel', 'inactive', 'never_ordered', 'coin_balance', 'sellers', 'riders'];
export const DEEP_LINK_TYPES = ['none', 'product', 'category', 'store', 'offer', 'spin'];
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'completed', 'paused', 'cancelled'];

const statsSchema = new mongoose.Schema(
    {
        targeted: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        /** Not sent on purpose: opted out, over the daily cap. */
        skipped: { type: Number, default: 0 },
        /** Sent pushes the person tapped (counted once per delivery). */
        opened: { type: Number, default: 0 },
    },
    { _id: false }
);

const pushCampaignSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true, trim: true },
        imageUrl: { type: String, default: '', trim: true },
        audience: {
            type: { type: String, enum: AUDIENCE_TYPES, required: true },
            zoneIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
            /** channel audience: ordered in Quick, Shop, or either. */
            channel: { type: String, enum: ['quick', 'shop', 'any'], default: 'any' },
            /** channel: ordered within N days; inactive: no order for N days. */
            days: { type: Number, default: 30, min: 1 },
            minCoins: { type: Number, default: 0, min: 0 },
        },
        deepLink: {
            type: { type: String, enum: DEEP_LINK_TYPES, default: 'none' },
            /** Product/category/store id or slug, or an offer code. */
            value: { type: String, default: '', trim: true },
        },
        link: { type: String, default: '' },
        schedule: {
            type: { type: String, enum: ['now', 'once', 'recurring'], default: 'now' },
            sendAt: { type: Date, default: null },
            frequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
            /** HH:mm in the store timezone. */
            timeOfDay: { type: String, default: '10:00' },
            /** 0 (Sunday) .. 6, for weekly. */
            daysOfWeek: { type: [Number], default: [] },
            startsAt: { type: Date, default: null },
            endsAt: { type: Date, default: null },
        },
        status: { type: String, enum: CAMPAIGN_STATUSES, default: 'scheduled', index: true },
        nextRunAt: { type: Date, default: null, index: true },
        /** The occurrence being (or about to be) sent; a re-run of it never sends twice. */
        runKey: { type: String, default: '' },
        lastRunAt: { type: Date, default: null },
        runCount: { type: Number, default: 0 },
        heartbeatAt: { type: Date, default: null },
        stats: { type: statsSchema, default: () => ({}) },
        runs: {
            type: [
                new mongoose.Schema(
                    {
                        runKey: String,
                        startedAt: Date,
                        finishedAt: Date,
                        targeted: Number,
                        sent: Number,
                        failed: Number,
                        skipped: Number,
                        opened: Number,
                    },
                    { _id: false }
                ),
            ],
            default: [],
        },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    },
    { collection: 'push_campaigns', timestamps: true }
);

pushCampaignSchema.index({ status: 1, nextRunAt: 1 });

/** One person in one run of a campaign. The unique index makes a re-run idempotent. */
const pushCampaignDeliverySchema = new mongoose.Schema(
    {
        campaignId: { type: mongoose.Schema.Types.ObjectId, required: true },
        runKey: { type: String, required: true },
        ownerType: { type: String, enum: ['USER', 'SELLER', 'DELIVERY_PARTNER'], required: true },
        ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        status: { type: String, enum: ['pending', 'processing', 'sent', 'failed', 'skipped'], default: 'pending' },
        reason: { type: String, default: '' },
        /** Store-local YYYY-MM-DD it was sent on: the daily frequency cap counts these. */
        localDay: { type: String, default: '' },
        sentAt: { type: Date, default: null },
        /** When the person first tapped the push; set once. */
        openedAt: { type: Date, default: null },
    },
    { collection: 'push_campaign_deliveries', timestamps: true }
);

pushCampaignDeliverySchema.index({ campaignId: 1, runKey: 1, ownerType: 1, ownerId: 1 }, { unique: true });
pushCampaignDeliverySchema.index({ campaignId: 1, runKey: 1, status: 1 });
pushCampaignDeliverySchema.index({ ownerType: 1, ownerId: 1, localDay: 1, status: 1 });
pushCampaignDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const marketingPushSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        /** Most marketing pushes one person gets per store-local day (0 = no cap). */
        dailyCap: { type: Number, default: 3, min: 0 },
        quietHours: {
            enabled: { type: Boolean, default: true },
            start: { type: String, default: '22:00' },
            end: { type: String, default: '08:00' },
        },
        batchSize: { type: Number, default: 200, min: 1 },
        /** Pause between batches, to spread load on FCM. */
        batchDelayMs: { type: Number, default: 1000, min: 0 },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'marketing_push_settings', timestamps: true }
);

/** A person's notification choices. No row means the defaults (marketing on). */
const notificationPreferenceSchema = new mongoose.Schema(
    {
        ownerType: { type: String, enum: ['USER', 'SELLER', 'DELIVERY_PARTNER'], required: true },
        ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        marketingPush: { type: Boolean, default: true },
    },
    { collection: 'notification_preferences', timestamps: true }
);
notificationPreferenceSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
notificationPreferenceSchema.index({ ownerType: 1, marketingPush: 1 });

export const PushCampaign = mongoose.model('PushCampaign', pushCampaignSchema);
export const PushCampaignDelivery = mongoose.model('PushCampaignDelivery', pushCampaignDeliverySchema);
export const MarketingPushSettings = mongoose.model('MarketingPushSettings', marketingPushSettingsSchema);
export const NotificationPreference = mongoose.model('NotificationPreference', notificationPreferenceSchema);
