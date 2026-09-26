import mongoose from 'mongoose';

/**
 * SellerWallet — tracks the financial balance for each seller.
 * Credited when orders are delivered; debited when settlements are processed.
 */
const sellerWalletSchema = new mongoose.Schema(
    {
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Seller',
            required: true,
            unique: true,
            index: true
        },
        balance: { type: Number, default: 0 },
        /** Amount locked for pending settlements (cannot be withdrawn) */
        lockedAmount: { type: Number, default: 0, min: 0 },
        /** Lifetime earnings */
        totalEarnings: { type: Number, default: 0, min: 0 },
        /** Total amount already settled/paid out */
        totalSettled: { type: Number, default: 0, min: 0 }
    },
    { collection: 'seller_wallets', timestamps: true }
);

export const SellerWallet = mongoose.model('SellerWallet', sellerWalletSchema);
