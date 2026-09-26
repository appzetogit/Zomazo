import mongoose from 'mongoose';

/**
 * Platform coins: promotional credit, kept apart from the wallet (which is real
 * money the customer paid in). Refunds, rewards and admin grants credit coins;
 * orders spend them.
 *
 * Each credit is a lot. Only part of a lot can ever be spent (the redeem
 * percentage in force when it was credited, 80% by default: a 1,000-coin
 * refund is worth at most ₹800), and the unspent part expires on its own date.
 * Spending takes from the lots that expire first.
 */
const coinLotSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        amount: { type: Number, required: true, min: 0 },
        /** The part of `amount` that can be spent: fixed when credited. */
        spendable: { type: Number, required: true, min: 0 },
        used: { type: Number, default: 0, min: 0 },
        expiresAt: { type: Date, required: true },
        expiredAt: { type: Date, default: null },
        /** When the customer was reminded this lot is about to expire. */
        expiryNotifiedAt: { type: Date, default: null },
        source: {
            type: String,
            enum: ['refund', 'admin', 'campaign', 'spin', 'referral', 'reversal'],
            required: true,
        },
        /** What the credit is for (a refund, an order, a spin), so a retry credits once. */
        refId: { type: String, default: null },
        note: { type: String, trim: true, default: '' },
    },
    { collection: 'coin_lots', timestamps: true }
);

coinLotSchema.index({ userId: 1, expiresAt: 1 });
coinLotSchema.index(
    { source: 1, refId: 1 },
    { unique: true, partialFilterExpression: { refId: { $type: 'string' } } }
);

/**
 * Every movement, for the customer's history and the liability report.
 * A debit records which lots it drew from, so a cancelled order puts the
 * coins back exactly where they came from.
 */
const coinLedgerSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        type: { type: String, enum: ['credit', 'debit', 'reversal', 'expire', 'adjust'], required: true },
        /** Coins moved; for a credit, what was credited (not what is spendable). */
        amount: { type: Number, required: true, min: 0 },
        /** For a credit: the spendable part. */
        spendable: { type: Number, default: null },
        source: { type: String, default: '' },
        refId: { type: String, default: null },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
        allocations: {
            // `returned`: how much of this lot's share has gone back to it since.
            type: [{ lotId: mongoose.Schema.Types.ObjectId, amount: Number, returned: { type: Number, default: 0 }, _id: false }],
            default: undefined,
        },
        /** On a debit: coins given back so far (cancelled orders of a split checkout). */
        returned: { type: Number, default: 0 },
        /** On a debit: set once everything has been given back. */
        reversedAt: { type: Date, default: null },
        note: { type: String, trim: true, default: '' },
        actorId: { type: String, default: null },
    },
    { collection: 'coin_ledger', timestamps: true }
);

coinLedgerSchema.index({ userId: 1, createdAt: -1 });
// One redemption per order: a retried checkout cannot spend twice.
coinLedgerSchema.index(
    { orderId: 1 },
    { unique: true, partialFilterExpression: { type: 'debit', orderId: { $type: 'objectId' } } }
);

// Each return is recorded once per reference (an order, a cancellation).
coinLedgerSchema.index(
    { refId: 1 },
    { unique: true, partialFilterExpression: { type: 'reversal', refId: { $type: 'string' } } }
);

const coinSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        isEnabled: { type: Boolean, default: true },
        /** Share of each credited lot that can be spent. */
        redeemPercent: { type: Number, default: 80, min: 0, max: 100 },
        expiryDays: { type: Number, default: 90, min: 1 },
        /** Share of one order's total that coins may pay. */
        maxOrderPercent: { type: Number, default: 50, min: 0, max: 100 },
        /** Rupees one coin is worth. */
        coinValue: { type: Number, default: 1, min: 0 },
    },
    { collection: 'coin_settings', timestamps: true }
);

export const CoinLot = mongoose.model('CoinLot', coinLotSchema);
export const CoinLedger = mongoose.model('CoinLedger', coinLedgerSchema);
export const CoinSettings = mongoose.model('CoinSettings', coinSettingsSchema);
