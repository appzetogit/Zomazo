/**
 * Keeps platform_orders in step with each service's own records, from the
 * service's model -- so no write path through mongoose is missed.
 *
 *   attachPlatformOrderSync(schema, service)
 *
 * is called in each order/ride/booking model file before the model is made
 * (food, quickCommerce, ecommerce, taxi, serviceProvider). After a save,
 * findOneAndUpdate, updateOne / updateMany, insertMany or delete, the record's
 * row is re-synced from the database (core/orders/platformOrders.service.js
 * syncPlatformOrder). When the write ran inside a transaction the sync waits
 * until the transaction has ended and then reads what was committed: a rolled
 * back write leaves the row as it was. The order flow never waits for it and
 * never sees an error from it.
 *
 * CommonJS so the Services models (CommonJS) can use it as easily as the ESM ones.
 * Writes made with the raw driver (Model.collection.*) bypass mongoose and are
 * not seen here; the backfill script re-syncs those.
 */

const pending = new Set();
const MAX_WAIT_MS = 2 * 60 * 1000;

let servicePromise = null;
const service = () => {
  if (!servicePromise) servicePromise = import('./platformOrders.service.js');
  return servicePromise;
};

const inTransaction = (session) => {
  try {
    return Boolean(session && typeof session.inTransaction === 'function' && session.inTransaction());
  } catch {
    return false;
  }
};

function schedule(name, ids, session) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!list.length) return;
  const job = (async () => {
    // A write inside a transaction is synced once the transaction has ended.
    const started = Date.now();
    while (inTransaction(session) && Date.now() - started < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setImmediate(r));
    const { syncPlatformOrder } = await service();
    for (const id of list) await syncPlatformOrder(name, id);
  })().catch((err) => console.warn(`[platformOrders] sync failed: ${err.message}`));
  pending.add(job);
  job.finally(() => pending.delete(job));
}

const sessionOfQuery = (query) => {
  try {
    return query.getOptions().session || query.options?.session || null;
  } catch {
    return null;
  }
};

const ID_CAP = 5000;

/** The ids a query is about to touch (before it runs, so a status change that moves them out of the filter is still seen). */
async function captureIds(query) {
  try {
    const filter = query.getFilter() || {};
    const docs = await query.model.find(filter, { _id: 1 }, { session: sessionOfQuery(query) }).limit(ID_CAP).lean();
    query._platformOrderIds = docs.map((d) => d._id);
  } catch {
    query._platformOrderIds = [];
  }
}

function attachPlatformOrderSync(schema, name) {
  schema.post('save', function afterSave(doc) {
    schedule(name, [doc && doc._id], doc && typeof doc.$session === 'function' ? doc.$session() : null);
  });
  schema.post('insertMany', function afterInsertMany(docs) {
    const list = Array.isArray(docs) ? docs : [docs];
    schedule(name, list.map((d) => d && d._id), list[0] && typeof list[0].$session === 'function' ? list[0].$session() : null);
  });

  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
    schema.pre(op, async function beforeWrite() {
      await captureIds(this);
    });
    schema.post(op, function afterWrite(result) {
      const ids = [...(this._platformOrderIds || [])];
      if (result && result._id) ids.push(result._id);
      if (result && result.upsertedId) ids.push(result.upsertedId);
      if (result && result.lastErrorObject && result.lastErrorObject.upserted) ids.push(result.lastErrorObject.upserted);
      schedule(name, ids, sessionOfQuery(this));
    });
  }
  // A document's own deleteOne().
  schema.post('deleteOne', { document: true, query: false }, function afterDocDelete(doc) {
    schedule(name, [doc && doc._id], null);
  });
}

/** Resolves when every sync scheduled so far has finished (tests, the backfill). */
async function flushPlatformOrderSync() {
  while (pending.size) await Promise.allSettled([...pending]);
}

module.exports = { attachPlatformOrderSync, flushPlatformOrderSync };
