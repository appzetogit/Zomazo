/**
 * Move Quick commerce's refunds, settlements and entity transactions into the
 * core collections.
 *
 *   node scripts/migrations/mergeQcPayments.mjs              # dry run (default)
 *   node scripts/migrations/mergeQcPayments.mjs --apply      # copies every row
 *   node scripts/migrations/mergeQcPayments.mjs --drop-old   # later: retires the qc_ collections
 *
 *   qc_refunds              -> refunds       vertical 'quickCommerce'
 *   qc_settlements          -> settlements   vertical 'quickCommerce'
 *   qc_entity_transactions  -> transactions  vertical 'quickCommerce'
 *
 * Rows keep their _id, so everything pointing at one (a return's refundId, a
 * settlement's transactionIds) still finds it; qc_payment_id_map records each
 * copy. The core's own rows have no vertical and the two never read each other's
 * (core/payments/models/verticalPayments.js). Deploy the code first: until a
 * collection is fully copied Quick reads both, and a row it touches is copied
 * on the spot. Idempotent and resumable. Nothing is deleted; --drop-old refuses
 * unless every row is copied, then renames each to <name>_premerge_<date>.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { renameWhenIdle } from './renameCollection.mjs';

export async function mergeQcPayments({ apply = false, dropOld = false, log = console.log } = {}) {
    const [{ refundsReadThrough, QC_PAYMENT_ID_MAP }, { settlementsReadThrough }, { transactionsReadThrough }, { clearReadThroughCache }] = await Promise.all([
        import('../../src/modules/quickCommerce/core/payments/models/refund.model.js'),
        import('../../src/modules/quickCommerce/core/payments/models/settlement.model.js'),
        import('../../src/modules/quickCommerce/core/payments/models/transaction.model.js'),
        import('../../src/core/payments/models/verticalPayments.js'),
    ]);
    const db = mongoose.connection;
    const jobs = [
        ['qc_refunds', 'refunds', refundsReadThrough],
        ['qc_settlements', 'settlements', settlementsReadThrough],
        ['qc_entity_transactions', 'transactions', transactionsReadThrough],
    ];
    const exists = async (name) => (await db.db.listCollections({ name }).toArray()).length > 0;
    const out = {};

    for (const [from, to, rt] of jobs) {
        if (!(await exists(from))) {
            out[from] = { rows: 0, missing: true };
            continue;
        }
        const rows = await db.collection(from).find({}).toArray();
        const ids = rows.map((r) => r._id);
        const present = new Set((await db.collection(to).find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((r) => String(r._id)));
        const waiting = rows.filter((r) => !present.has(String(r._id)));

        if (dropOld) {
            if (waiting.length) {
                log(`Refusing --drop-old for ${from}: ${waiting.length} rows not copied. Run --apply first.`);
                out[from] = { refused: true, waiting: waiting.length };
                continue;
            }
            const name = `${from}_premerge_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
            await renameWhenIdle(db.collection(from), name);
            log(`${from} renamed to ${name}.`);
            out[from] = { renamed: name };
            continue;
        }

        if (apply) {
            for (const row of waiting) await rt.copy(row);
            // Rows copied by an earlier run or on the spot are recorded too.
            for (const row of rows) {
                await db.collection(QC_PAYMENT_ID_MAP).updateOne(
                    { _id: row._id },
                    { $setOnInsert: { from, to, at: new Date() } },
                    { upsert: true },
                );
            }
            await db.collection(QC_PAYMENT_ID_MAP).updateOne(
                { _id: `__all_copied__:${from}` },
                { $set: { at: new Date(), rows: rows.length } },
                { upsert: true },
            );
        }
        out[from] = { rows: rows.length, alreadyCopied: rows.length - waiting.length, [apply ? 'copied' : 'toCopy']: waiting.length };
        log(`${from} -> ${to}: ${rows.length} rows, ${rows.length - waiting.length} already there, ${waiting.length} ${apply ? 'copied' : 'to copy'}`);
    }
    if (apply) clearReadThroughCache();
    if (!apply && !dropOld) log('Dry run: nothing written.');
    return out;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('mergeQcPayments: MONGO_URI is not set.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        await mergeQcPayments({ apply: process.argv.includes('--apply'), dropOld: process.argv.includes('--drop-old') });
    } finally {
        await mongoose.disconnect();
    }
}
