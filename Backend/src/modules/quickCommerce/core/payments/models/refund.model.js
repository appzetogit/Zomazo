/**
 * Quick's refunds: rows of the core `refunds` collection marked
 * vertical 'quickCommerce' (core/payments/models/verticalPayments.js). They
 * were in qc_refunds; scripts/migrations/mergeQcPayments.mjs copies those over
 * (same _id), and refundsReadThrough reads both until it has.
 */
import { Refund as CoreRefund } from '../../../../../core/payments/models/refund.model.js';
import { readThrough, verticalModel } from '../../../../../core/payments/models/verticalPayments.js';

export const QC_PAYMENT_ID_MAP = 'qc_payment_id_map';

export const Refund = verticalModel(CoreRefund, 'quickCommerce', 'QCRefund', { orderId: 'QCOrder' });

export const refundsReadThrough = readThrough({
    model: Refund,
    vertical: 'quickCommerce',
    legacyCollection: 'qc_refunds',
    mapCollection: QC_PAYMENT_ID_MAP,
});
