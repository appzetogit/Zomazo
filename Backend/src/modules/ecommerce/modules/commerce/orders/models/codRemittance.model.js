import mongoose from 'mongoose';

/**
 * A courier's COD remittance: the money it collected on delivery and paid over
 * (one bank transfer, identified by its UTR / reference), with the AWBs it covers.
 * Each line is matched to our delivered COD shipment when saved.
 */
const lineSchema = new mongoose.Schema(
    {
        awb: { type: String, required: true, trim: true },
        amount: { type: Number, required: true, min: 0 },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
        orderCode: { type: String, default: '' },
        expected: { type: Number, default: null },
        /** matched | short | excess | unexpected | duplicate */
        status: { type: String, default: 'unexpected' },
        note: { type: String, default: '' },
    },
    { _id: false },
);

const codRemittanceSchema = new mongoose.Schema(
    {
        courier: { type: String, required: true, trim: true },
        reference: { type: String, required: true, trim: true, unique: true },
        date: { type: Date, required: true },
        note: { type: String, default: '', trim: true },
        lines: { type: [lineSchema], default: [] },
        totals: {
            received: { type: Number, default: 0 },
            expected: { type: Number, default: 0 },
            matched: { type: Number, default: 0 },
            short: { type: Number, default: 0 },
            excess: { type: Number, default: 0 },
            unexpected: { type: Number, default: 0 },
            duplicate: { type: Number, default: 0 },
        },
        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'cod_remittances', timestamps: true },
);

codRemittanceSchema.index({ date: -1 });
codRemittanceSchema.index({ 'lines.awb': 1 });

export const CodRemittance = mongoose.model('CodRemittance', codRemittanceSchema);
