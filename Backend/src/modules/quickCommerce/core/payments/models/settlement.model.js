/**
 * Quick's settlements: rows of the core `settlements` collection marked
 * vertical 'quickCommerce' (core/payments/models/verticalPayments.js). They
 * were in qc_settlements; scripts/migrations/mergeQcPayments.mjs copies those
 * over (same _id), and settlementsReadThrough reads both until it has.
 */
import { Settlement as CoreSettlement } from '../../../../../core/payments/models/settlement.model.js';
import { readThrough, verticalModel } from '../../../../../core/payments/models/verticalPayments.js';
import { QC_PAYMENT_ID_MAP } from './refund.model.js';

export const Settlement = verticalModel(CoreSettlement, 'quickCommerce', 'QCSettlement', { transactionIds: 'QCEntityTransaction' });

export const settlementsReadThrough = readThrough({
    model: Settlement,
    vertical: 'quickCommerce',
    legacyCollection: 'qc_settlements',
    mapCollection: QC_PAYMENT_ID_MAP,
});
