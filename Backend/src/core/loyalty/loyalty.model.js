import mongoose from 'mongoose';

/**
 * Loyalty points: earned on completed orders in any service, held per platform
 * account (users._id), and turned into wallet money at a rate admin sets.
 *
 * The ledger is the record of every earn, conversion and take-back; the account
 * holds the running balance so a conversion can check and spend it in one
 * conditional update.
 */

/** One document: the programme's rules. */
const loyaltySettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        isEnabled: { type: Boolean, default: false },
        // Points earned for every Rs 100 of an order (floored per order).
        pointsPerHundred: { type: Number, default: 0, min: 0 },
        // How many points make Rs 1 of wallet money.
        pointsPerRupee: { type: Number, default: 10, min: 1 },
        // The smallest conversion a customer may make.
        minConvertPoints: { type: Number, default: 100, min: 1 },
        // Services whose orders earn points; empty is every service.
        services: { type: [String], default: [] },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'platform_loyalty_settings', timestamps: true },
);

export const LoyaltySettings = mongoose.models.LoyaltySettings
    || mongoose.model('LoyaltySettings', loyaltySettingsSchema);

const loyaltyAccountSchema = new mongoose.Schema(
    {
        platformUserId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
        balance: { type: Number, default: 0, min: 0 },
        earned: { type: Number, default: 0, min: 0 },
        converted: { type: Number, default: 0, min: 0 },
    },
    { collection: 'platform_loyalty_accounts', timestamps: true },
);

export const LoyaltyAccount = mongoose.models.LoyaltyAccount
    || mongoose.model('LoyaltyAccount', loyaltyAccountSchema);

const loyaltyLedgerSchema = new mongoose.Schema(
    {
        platformUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        // earn: an order paid points; convert: points became wallet money;
        // reverse: a refund took back points its order earned.
        type: { type: String, enum: ['earn', 'convert', 'reverse'], required: true },
        points: { type: Number, required: true, min: 0 },
        balanceAfter: { type: Number, default: 0 },
        service: { type: String, default: '' },
        orderId: { type: String, default: '' },
        orderDisplayId: { type: String, default: '' },
        // Rupees credited to the wallet by a conversion.
        walletAmount: { type: Number, default: 0 },
        // Makes every move happen once: earn:<service>:<order>, convert:<uuid>, ...
        referenceKey: { type: String, required: true, unique: true },
        status: { type: String, enum: ['completed', 'pending'], default: 'completed' },
    },
    { collection: 'platform_loyalty_ledger', timestamps: true },
);
loyaltyLedgerSchema.index({ createdAt: -1 });

export const LoyaltyLedger = mongoose.models.LoyaltyLedger
    || mongoose.model('LoyaltyLedger', loyaltyLedgerSchema);
