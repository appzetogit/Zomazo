import mongoose from 'mongoose';

import { ecomModel } from '../../../../config/ecomModel.js';
const sellerCommissionSchema = new mongoose.Schema(
    {
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'EcomSeller',
            required: true,
            unique: true,
            index: true
        },
        defaultCommission: {
            type: {
                type: String,
                enum: ['percentage', 'amount'],
                default: 'percentage'
            },
            value: { type: Number, default: 0 }
        },
        notes: { type: String, trim: true, default: '' },
        status: { type: Boolean, default: true, index: true }
    },
    { collection: 'seller_commissions', timestamps: true }
);


export const SellerCommission = ecomModel('SellerCommission', sellerCommissionSchema);

