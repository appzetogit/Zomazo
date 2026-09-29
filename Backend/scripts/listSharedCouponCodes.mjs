/**
 * List coupon codes that more than one service uses.
 *
 * New codes are now unique across the platform (core/promotions/
 * couponCodeRegistry.js), but codes created before that are left as they are.
 * This lists them, so an admin can rename the ones that confuse customers.
 * Read-only.
 *
 *   node scripts/listSharedCouponCodes.mjs
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('listSharedCouponCodes: MONGO_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
const { COUPON_CODE_HOLDERS } = await import('../src/core/promotions/couponCodeRegistry.js');

const byCode = new Map();
for (const holder of COUPON_CODE_HOLDERS) {
  const rows = await mongoose.connection.db
    .collection(holder.collection)
    .find({}, { projection: { [holder.field]: 1 } })
    .toArray();
  for (const row of rows) {
    const code = String(row[holder.field] || '').trim().toUpperCase();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, new Set());
    byCode.get(code).add(holder.label);
  }
}

const shared = [...byCode.entries()].filter(([, services]) => services.size > 1);
if (shared.length === 0) {
  console.log('No coupon code is used by more than one service.');
} else {
  console.log(`${shared.length} code(s) used by more than one service:`);
  for (const [code, services] of shared.sort()) console.log(`  ${code}: ${[...services].join(', ')}`);
}

await mongoose.disconnect();
