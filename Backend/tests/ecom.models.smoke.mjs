/**
 * E-commerce models: every one registers under Ecom*, on an ecom_* collection,
 * without colliding with the rest of the platform, and every ref resolves.
 *
 * The e-commerce module is a port of a standalone app whose models were called
 * Order, Product, User, Zone... Two ways that goes wrong silently:
 *   - a model that escaped the rename shares a collection with food or taxi and
 *     reads their documents;
 *   - a ref left pointing at the old name makes populate() throw
 *     MissingSchemaError on whichever endpoint nobody happened to test.
 *
 * Run: node tests/ecom.models.smoke.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const ecomRoot = join(src, 'modules', 'ecommerce');

const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
    return /\.model\.js$|[\\/]models[\\/][^\\/]+\.js$/.test(p) ? [p] : [];
});

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL ${msg}`); };

// Load the rest of the platform's models first, so a collision shows up as one.
const platformFiles = walk(src).filter((f) => !f.startsWith(ecomRoot));
for (const f of platformFiles) {
    try { await import(pathToFileURL(f).href); } catch { /* not every match is a model file */ }
}
const platformModels = new Map(
    Object.values(mongoose.models).map((m) => [m.modelName, m.collection.collectionName]),
);
const platformCollections = new Set(platformModels.values());

for (const f of walk(ecomRoot)) {
    try {
        await import(pathToFileURL(f).href);
    } catch (err) {
        fail(`${f.slice(ecomRoot.length)} failed to load: ${err.message}`);
    }
}

const ecomModels = Object.values(mongoose.models).filter((m) => !platformModels.has(m.modelName));
if (ecomModels.length < 80) fail(`expected ~90 e-commerce models, found ${ecomModels.length}`);

for (const m of ecomModels) {
    if (!m.modelName.startsWith('Ecom')) fail(`${m.modelName}: not Ecom-prefixed`);
    const coll = m.collection.collectionName;
    if (!coll.startsWith('ecom_')) fail(`${m.modelName}: collection ${coll} is not ecom_-prefixed`);
    if (platformCollections.has(coll)) fail(`${m.modelName}: collection ${coll} is also used by the platform`);
}

// Deliberate links out to the platform: the satellite -> shared identity.
const PLATFORM_REFS = new Set(['EcomUser.platformUserId:FoodUser']);

const refsOf = (schema, prefix = '') => {
    const out = [];
    schema.eachPath((path, type) => {
        const ref = type.options?.ref ?? type.caster?.options?.ref;
        if (typeof ref === 'string') out.push([prefix + path, ref]);
        if (type.schema) out.push(...refsOf(type.schema, `${prefix}${path}.`));
    });
    return out;
};
for (const m of ecomModels) {
    for (const [path, ref] of refsOf(m.schema)) {
        if (!mongoose.models[ref]) fail(`${m.modelName}.${path} refs unknown model '${ref}'`);
        else if (!ref.startsWith('Ecom') && !PLATFORM_REFS.has(`${m.modelName}.${path}:${ref}`)) fail(`${m.modelName}.${path} refs platform model '${ref}'`);
    }
}

console.log(`${ecomModels.length} e-commerce models checked`);
if (failures) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
}
console.log('ok');
process.exit(0);
