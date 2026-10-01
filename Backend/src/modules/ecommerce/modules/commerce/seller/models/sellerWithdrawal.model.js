import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const sellerWithdrawalSchema = new mongoose.Schema({
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EcomSeller',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: [1, 'Minimum withdrawal amount is ₹1']
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    paymentMethod: {
        type: String,
        default: 'bank_transfer'
    },
    bankDetails: {
        accountNumber: String,
        ifscCode: String,
        bankName: String,
        accountHolderName: String
    },
    adminNote: String,
    rejectionReason: String,
    transactionId: String, // Final bank transaction reference from admin
    // Bank payout through RazorpayX (state, payout id, UTR); see core/payouts/payout.service.js.
    payout: { type: mongoose.Schema.Types.Mixed, default: undefined },
    processedAt: Date
}, { 
    collection: 'seller_withdrawals', 
    timestamps: true 
});

sellerWithdrawalSchema.index({ createdAt: -1 });

export const SellerWithdrawal = ecomModel('SellerWithdrawal', sellerWithdrawalSchema);
