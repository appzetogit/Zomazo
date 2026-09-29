/**
 * Quick's order ledger and its entity (wallet) ledger are two models, not one
 * name fought over by load order.
 *
 * Run: node tests/qc-transaction-models-apart.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';

// Load order used to decide which schema won; load both, either way round.
const { Transaction } = await import('../src/modules/quickCommerce/core/payments/models/transaction.model.js');
const { FoodTransaction } = await import('../src/modules/quickCommerce/modules/food/orders/models/foodTransaction.model.js');

assert.notEqual(Transaction.modelName, FoodTransaction.modelName, 'two model names');
assert.notEqual(Transaction.collection.collectionName, FoodTransaction.collection.collectionName, 'two collections');
assert.equal(FoodTransaction.collection.collectionName, 'qc_transactions', 'the order ledger keeps its data');
assert.ok(Transaction.schema.path('entityType'), 'the entity ledger has its own schema');
assert.ok(FoodTransaction.schema.path('amounts.restaurantShare'), 'the order ledger has its own schema');

const row = new Transaction({
    entityType: 'restaurant', entityId: new mongoose.Types.ObjectId(), type: 'credit', amount: 100,
    balanceAfter: 100, currency: 'INR', status: 'completed', description: 'settlement', category: 'delivery_earning', module: 'quickCommerce',
});
assert.equal(row.validateSync(), undefined, 'an entity ledger row validates (it was refused as an order row)');

console.log('All Quick transaction model checks passed');
process.exit(0);
