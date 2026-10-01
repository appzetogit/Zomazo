import mongoose from 'mongoose';

/**
 * One refunds / settlements / transactions collection for every vertical.
 *
 * Quick commerce kept its own copies of the core payment records (qc_refunds,
 * qc_settlements, qc_entity_transactions) with the same schemas. They now live
 * in the core collections (refunds, settlements, transactions), each row
 * carrying `vertical` -- null for the core's own rows, 'quickCommerce' for
 * Quick's -- so the two never read each other's:
 *
 *   - the core models (./refund.model.js ...) call markCoreRows(schema): a
 *     query that does not name a vertical reads only rows with none;
 *   - verticalModel(base, vertical, ...) is that same schema and collection
 *     for one vertical: it writes `vertical` and every query is narrowed to it.
 *
 * Quick's rows that have not been copied yet (scripts/migrations/
 * mergeQcPayments.mjs) are still read through readThrough() below, so the code
 * serves the same answers before and after the script.
 */

const QUERY_OPS = [
    'find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany',
    'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne',
];

/** On a core schema: rows of a vertical are invisible unless a query names it. */
export function markCoreRows(schema) {
    schema.add({ vertical: { type: String, default: null, index: true } });
    schema.pre(QUERY_OPS, function narrowToCore() {
        const filter = this.getFilter();
        if (!Object.prototype.hasOwnProperty.call(filter, 'vertical')) this.setQuery({ ...filter, vertical: null });
    });
}

/**
 * The base model's schema and collection, for one vertical.
 * @param {mongoose.Model} base     a core model whose schema went through markCoreRows
 * @param {string} vertical         e.g. 'quickCommerce'
 * @param {string} name             a model name unique to the vertical
 * @param {object} [refs]           path -> model name, e.g. { orderId: 'QCOrder' }
 */
export function verticalModel(base, vertical, name, refs = {}) {
    if (mongoose.models[name]) return mongoose.models[name];
    const schema = base.schema.clone();
    schema.path('vertical').default(vertical);
    for (const [path, ref] of Object.entries(refs)) {
        const p = schema.path(path);
        if (p?.options) p.options.ref = ref;
        if (p?.caster?.options) p.caster.options.ref = ref;
    }
    schema.pre(QUERY_OPS, function narrowToVertical() {
        this.setQuery({ ...this.getFilter(), vertical });
    });
    return mongoose.model(name, schema, base.collection.collectionName);
}

const isMigrated = new Map();

/**
 * Reads that also see a vertical's rows still in its old collection, until the
 * migration has copied them (it writes { _id: doneKey } in the map collection).
 * Copies keep their _id, so a row present in both is the same row; the core
 * copy wins.
 */
export function readThrough({ model, vertical, legacyCollection, mapCollection, doneKey = '__all_copied__' }) {
    const legacy = () => mongoose.connection.collection(legacyCollection);
    const migrated = async () => {
        const hit = isMigrated.get(legacyCollection);
        if (hit && (hit.done || Date.now() - hit.at < 60 * 1000)) return hit.done;
        const done = Boolean(await mongoose.connection.collection(mapCollection).findOne({ _id: `${doneKey}:${legacyCollection}` }));
        isMigrated.set(legacyCollection, { done, at: Date.now() });
        return done;
    };

    /** Copy one old row into the core collection (same _id), marked. */
    const copy = async (doc) => {
        try {
            await model.collection.insertOne({ ...doc, vertical });
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }
        await mongoose.connection.collection(mapCollection).updateOne(
            { _id: doc._id },
            { $set: { from: legacyCollection, to: model.collection.collectionName, at: new Date() } },
            { upsert: true },
        );
    };

    return {
        copy,
        migrated,
        /** A mongoose document from the core collection; an old row is copied first. */
        async findById(id) {
            if (!mongoose.Types.ObjectId.isValid(String(id || ''))) return null;
            const found = await model.findById(id);
            if (found || (await migrated())) return found;
            const old = await legacy().findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
            if (!old) return null;
            await copy(old);
            return model.findById(id);
        },
        /** Lean rows, newest first, from both until the copy is done. */
        async list(filter = {}, { skip = 0, limit = 0 } = {}) {
            const sort = { createdAt: -1 };
            const core = model.find(filter).sort(sort);
            if (await migrated()) {
                const [docs, total] = await Promise.all([
                    (limit ? core.skip(skip).limit(limit) : core).lean(),
                    model.countDocuments(filter),
                ]);
                return { docs, total };
            }
            const want = limit ? skip + limit : 0;
            const [mine, oldRows] = await Promise.all([
                (want ? core.limit(want) : core).lean(),
                legacy().find(filter).sort(sort).toArray(),
            ]);
            const seen = new Set(mine.map((d) => String(d._id)));
            const copiedIds = oldRows.length
                ? new Set((await model.find({ _id: { $in: oldRows.map((r) => r._id) } }).select('_id').lean()).map((d) => String(d._id)))
                : new Set();
            const extra = oldRows.filter((r) => !seen.has(String(r._id)) && !copiedIds.has(String(r._id)));
            const merged = [...mine, ...extra].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            const total = (await model.countDocuments(filter)) + extra.length;
            return { docs: limit ? merged.slice(skip, skip + limit) : merged, total };
        },
    };
}

/** Forget cached "copied" answers (tests). */
export const clearReadThroughCache = () => isMigrated.clear();
