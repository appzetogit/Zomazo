/**
 * Registers an e-commerce model under the Ecom* name and an ecom_* collection.
 *
 * Mongoose keeps ONE model registry per process. This module was ported from a
 * standalone app whose models are called Order, Product, Category, Zone, User...
 * -- names the rest of the platform either owns already or may own tomorrow. A
 * second mongoose.model('Order') throws OverwriteModelError at boot; worse, one
 * that happens to share a collection name silently reads another vertical's data.
 *
 * So every model here goes through this helper: the name gains an Ecom prefix and
 * the collection an ecom_ prefix, the same way quick-commerce uses QC* / qc_*.
 *
 * The collection is derived rather than written out by hand: an explicit third
 * argument wins, then the schema's own `collection` option, then mongoose's own
 * pluralisation of the ORIGINAL name. That last one is exactly what the source
 * app's data sits in, so a migration can map old -> new mechanically.
 */
import mongoose from 'mongoose';

export const ECOM_MODEL_PREFIX = 'Ecom';
export const ECOM_COLLECTION_PREFIX = 'ecom_';

export const ecomModelName = (name) => `${ECOM_MODEL_PREFIX}${name}`;

export const ecomCollectionName = (name, schema, collection) => {
    const base = collection || schema?.options?.collection || mongoose.pluralize()(name);
    return base.startsWith(ECOM_COLLECTION_PREFIX) ? base : `${ECOM_COLLECTION_PREFIX}${base}`;
};

export const ecomModel = (name, schema, collection) => {
    const modelName = ecomModelName(name);
    if (mongoose.models[modelName]) return mongoose.models[modelName];
    return mongoose.model(modelName, schema, ecomCollectionName(name, schema, collection));
};
