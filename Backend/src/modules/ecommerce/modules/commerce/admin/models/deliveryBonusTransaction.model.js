import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const deliveryBonusTransactionSchema = new mongoose.Schema(
    {
        deliveryPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'EcomDeliveryPartner',
            required: true,
            index: true
        },
        transactionId: { type: String, required: true, trim: true, unique: true, index: true },
        amount: { type: Number, required: true, min: 0 },
        reference: { type: String, trim: true, default: '' },
        createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'EcomUser' }
    },
    { collection: 'delivery_bonus_transactions', timestamps: true }
);

deliveryBonusTransactionSchema.index({ deliveryPartnerId: 1, createdAt: -1 });

export const DeliveryBonusTransaction = ecomModel('DeliveryBonusTransaction', deliveryBonusTransactionSchema);

