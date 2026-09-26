import mongoose from 'mongoose';

/**
 * Default wheel segments configured with reward amounts and probability weights.
 */
export const DEFAULT_SPIN_SEGMENTS = [
    { id: 1, label: '10 Coins', type: 'coins', value: 10, color: '#f59e0b', weight: 35 },
    { id: 2, label: '25 Coins', type: 'coins', value: 25, color: '#8b5cf6', weight: 20 },
    { id: 3, label: 'Better Luck', type: 'none', value: 0, color: '#6b7280', weight: 15 },
    { id: 4, label: '50 Coins', type: 'coins', value: 50, color: '#10b981', weight: 10 },
    { id: 5, label: '5 Coins', type: 'coins', value: 5, color: '#3b82f6', weight: 18 },
    { id: 6, label: '100 Coins 🌟', type: 'coins', value: 100, color: '#ec4899', weight: 2 },
];

const spinCampaignSchema = new mongoose.Schema(
    {
        title: { type: String, default: 'Daily Lucky Wheel' },
        isActive: { type: Boolean, default: true },
        segments: {
            type: [
                {
                    id: Number,
                    label: String,
                    type: { type: String, enum: ['coins', 'none', 'coupon'], default: 'coins' },
                    value: Number,
                    color: String,
                    weight: Number,
                },
            ],
            default: DEFAULT_SPIN_SEGMENTS,
        },
        dailyLimit: { type: Number, default: 1, min: 1 },
        /** Coins the wheel may pay out per calendar month; 0 means no cap. */
        monthlyCoinBudget: { type: Number, default: 0, min: 0 },
        /** Optional schedule window; null means open-ended on that side. */
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null },
    },
    { collection: 'spin_campaigns', timestamps: true }
);

const spinResultSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'SpinCampaign', default: null },
        segmentWon: {
            id: Number,
            label: String,
            type: { type: String, enum: ['coins', 'none', 'coupon'] },
            value: Number,
        },
        rewardRef: { type: String, default: null },
        coinsAwarded: { type: Number, default: 0 },
        /** 'failed' when the coins could not be credited, for support to follow up. */
        rewardStatus: { type: String, enum: ['none', 'credited', 'failed'], default: 'none' },
        ip: { type: String, default: '' },
        /** The store-local day (YYYY-MM-DD) and which of that day's spins this is. */
        day: { type: String, required: true },
        seq: { type: Number, required: true, min: 1 },
    },
    { collection: 'spin_results', timestamps: true }
);

spinResultSchema.index({ userId: 1, createdAt: -1 });
// One document per spin slot: two taps at once cannot both use the same slot.
spinResultSchema.index({ userId: 1, day: 1, seq: 1 }, { unique: true });

/** Coins paid out per campaign per month, drawn down atomically against the budget. */
const spinBudgetSchema = new mongoose.Schema(
    {
        campaignId: { type: mongoose.Schema.Types.ObjectId, required: true },
        month: { type: String, required: true },
        used: { type: Number, default: 0 },
    },
    { collection: 'spin_budgets', timestamps: true }
);
spinBudgetSchema.index({ campaignId: 1, month: 1 }, { unique: true });

export const SpinCampaign = mongoose.model('SpinCampaign', spinCampaignSchema);
export const SpinResult = mongoose.model('SpinResult', spinResultSchema);
export const SpinBudget = mongoose.model('SpinBudget', spinBudgetSchema);
