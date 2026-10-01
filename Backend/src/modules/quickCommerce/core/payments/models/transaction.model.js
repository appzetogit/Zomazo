/**
 * Quick's entity ledger rows (wallet credits and debits of customers, stores,
 * riders and the platform): rows of the core `transactions` collection marked
 * vertical 'quickCommerce' (core/payments/models/verticalPayments.js).
 *
 * Its own model name, kept apart from the ORDER ledger ('QCTransaction' on
 * qc_transactions, orders/models/foodTransaction.model.js): the two once shared
 * a name, and every row written here was refused by the order schema.
 *
 * The rows were in qc_entity_transactions; scripts/migrations/mergeQcPayments.mjs
 * copies them over (same _id), and transactionsReadThrough reads both until it has.
 */
import { Transaction as CoreTransaction } from '../../../../../core/payments/models/transaction.model.js';
import { readThrough, verticalModel } from '../../../../../core/payments/models/verticalPayments.js';
import { QC_PAYMENT_ID_MAP } from './refund.model.js';

export const Transaction = verticalModel(CoreTransaction, 'quickCommerce', 'QCEntityTransaction', { orderId: 'QCOrder' });

export const transactionsReadThrough = readThrough({
    model: Transaction,
    vertical: 'quickCommerce',
    legacyCollection: 'qc_entity_transactions',
    mapCollection: QC_PAYMENT_ID_MAP,
});
