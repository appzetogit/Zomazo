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

/**
 * @param ids  the record ids, or an async function returning them -- run after the
 *             write (and after its transaction), off the request path.
 */
function schedule(name, ids, session) {
  if (Array.isArray(ids) && !ids.filter(Boolean).length) return;
  const job = (async () => {
    // A write inside a transaction is synced once the transaction has ended.
    const started = Date.now();
    while (inTransaction(session) && Date.now() - started < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setImmediate(r));
    const resolved = typeof ids === 'function' ? await ids() : ids;
    const list = [...new Set((resolved || []).filter(Boolean).map(String))];
    if (!list.length) return;
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

const isIdLike = (v) =>
  typeof v === 'string' || typeof v === 'number' || Boolean(v && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID'));

/** The ids a filter names outright ({_id}, {_id: {$eq}}, {_id: {$in: [...]}}), else null. */
function idsFromFilter(filter) {
  const v = filter && filter._id;
  if (v == null) return null;
  if (isIdLike(v)) return [v];
  if (typeof v === 'object' && v.$eq != null && isIdLike(v.$eq)) return [v.$eq];
  if (typeof v === 'object' && Array.isArray(v.$in) && v.$in.every(isIdLike)) return v.$in;
  return null;
}

/** Fields an update writes, or null when it cannot tell (a pipeline update). */
function touchedPaths(update) {
  if (!update || Array.isArray(update)) return null;
  const out = [];
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) {
      if (value && typeof value === 'object') out.push(...Object.keys(value));
    } else {
      out.push(key);
    }
  }
  return out;
}

const overlaps = (key, touched) => touched.some((t) => t === key || t.startsWith(`${key}.`) || key.startsWith(`${t}.`));

const mentions = (value, touched) => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => mentions(v, touched));
  return Object.entries(value).some(([k, v]) => (!k.startsWith('$') && overlaps(k, touched)) || mentions(v, touched));
};

/**
 * The filter with every condition on a field the update writes taken out.
 * `updateOne({ orderId, status: 'pending' }, { $set: { status: 'paid' } })` no
 * longer matches its own record afterwards; `{ orderId }` still does. Dropping
 * conditions only widens the match, so the records written are always in it.
 */
function relaxedFilter(filter, update) {
  const touched = touchedPaths(update);
  if (!touched) return {};
  const out = {};
  for (const [key, value] of Object.entries(filter || {})) {
    if (key.startsWith('$') ? mentions(value, touched) : overlaps(key, touched)) continue;
    out[key] = value;
  }
  return out;
}

function attachPlatformOrderSync(schema, name) {
  schema.post('save', function afterSave(doc) {
    schedule(name, [doc && doc._id], doc && typeof doc.$session === 'function' ? doc.$session() : null);
  });
  schema.post('insertMany', function afterInsertMany(docs) {
    const list = Array.isArray(docs) ? docs : [docs];
    schedule(name, list.map((d) => d && d._id), list[0] && typeof list[0].$session === 'function' ? list[0].$session() : null);
  });

  // findOneAnd*: the write returns the record, so its id is free.
  for (const op of ['findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete']) {
    schema.post(op, function afterFindAndWrite(result) {
      const doc = result && result.value !== undefined && result.lastErrorObject ? result.value : result;
      const ids = [doc && doc._id];
      if (result && result.lastErrorObject && result.lastErrorObject.upserted) ids.push(result.lastErrorObject.upserted);
      schedule(name, ids, sessionOfQuery(this));
    });
  }

  // updateOne / updateMany / replaceOne. These used to run a find() for the ids
  // BEFORE every write -- an extra read on the request path of every order
  // update. Now: a filter that names its ids costs nothing; any other filter is
  // re-read after the write, in the background, widened past the fields the
  // update changes so records it moved out of the filter are still found.
  for (const op of ['updateOne', 'updateMany', 'replaceOne']) {
    schema.post(op, function afterUpdate(result) {
      const filter = this.getFilter() || {};
      const upserted = result && result.upsertedId ? [result.upsertedId] : [];
      const named = idsFromFilter(filter);
      if (named) {
        schedule(name, [...named, ...upserted], sessionOfQuery(this));
        return;
      }
      if (result && result.matchedCount === 0 && !upserted.length) return;
      const model = this.model;
      const wider = op === 'replaceOne' ? relaxedFilter(filter, null) : relaxedFilter(filter, this.getUpdate());
      schedule(name, async () => {
        const docs = await model.find(wider, { _id: 1 }).limit(ID_CAP).lean();
        return [...docs.map((d) => d._id), ...upserted];
      }, sessionOfQuery(this));
    });
  }

  // Deletes: afterwards there is nothing left to read the ids from, so a filter
  // that does not name them is read first. Deletes of orders are rare (admin
  // clean-up), unlike updates.
  for (const op of ['deleteOne', 'deleteMany']) {
    schema.pre(op, { query: true, document: false }, async function beforeDelete() {
      const filter = this.getFilter() || {};
      const named = idsFromFilter(filter);
      if (named) {
        this._platformOrderIds = named;
        return;
      }
      try {
        const docs = await this.model.find(filter, { _id: 1 }, { session: sessionOfQuery(this) }).limit(ID_CAP).lean();
        this._platformOrderIds = docs.map((d) => d._id);
      } catch {
        this._platformOrderIds = [];
      }
    });
    schema.post(op, { query: true, document: false }, function afterDelete() {
      schedule(name, this._platformOrderIds || [], sessionOfQuery(this));
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
