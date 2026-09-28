import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const deliveryCashDepositSchema = new mongoose.Schema({
    deliveryPartnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EcomDeliveryPartner',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'razorpay', 'upi', 'bank_transfer'],
        default: 'cash'
    },
    status: {
        type: String,
        enum: ['Pending', 'Completed', 'Failed'],
        default: 'Pending',
        index: true
    },
    razorpayOrderId: {
        type: String,
        default: ''
    },
    razorpayPaymentId: String,
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EcomUser'
    },
    adminNote: String
}, { 
    collection: 'delivery_cash_deposits', 
    timestamps: true 
});

deliveryCashDepositSchema.index({ createdAt: -1 });
// One Razorpay payment settles cash once: this is what makes the upsert in
// verifyDeliveryCashDepositPayment hold under concurrency. Partial, so rows
// without a payment id (manual cash entries) are not constrained.
deliveryCashDepositSchema.index(
    { razorpayPaymentId: 1 },
    { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string' } } }
);

export const DeliveryCashDeposit = ecomModel('DeliveryCashDeposit', deliveryCashDepositSchema);
