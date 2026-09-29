/**
 * The Shop's ledger accounts for every rupee the customer paid, and GST
 * follows who funded the coupon.
 *
 * Run: node tests/shop-ledger-balances.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
    }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('shop_ledger');
await mongoose.connect(mongo.getUri('shop_ledger'));

const { createInitialTransaction } = await import('../src/modules/ecommerce/modules/commerce/orders/services/orderTransaction.service.js');
const oid = () => new mongoose.Types.ObjectId();
const r2 = (n) => Math.round(n * 100) / 100;

await check('seller + rider + platform + tax === what the customer paid, with coins and delivery GST', async () => {
    // 200 items + 10 packing + 30 delivery + 5.40 delivery GST + 5 platform + 10 item GST - 20 coins
    const pricing = { subtotal: 200, packagingFee: 10, deliveryFee: 30, deliveryFeeGst: 5.4, platformFee: 5, tax: 10, discount: 0, coinsDiscount: 20, sellerCommission: 20 };
    pricing.total = r2(200 + 10 + 30 + 5.4 + 5 + 10 - 20);
    const tx = await createInitialTransaction({
        _id: oid(), userId: oid(), sellerId: oid(), riderEarning: 25, pricing,
        payment: { method: 'cash', status: 'cod_pending' },
    });
    const a = tx.amounts;
    assert.equal(r2(a.sellerShare + a.riderShare + a.platformNetProfit + a.taxAmount), pricing.total);
    assert.equal(a.taxAmount, 15.4, 'the delivery fee GST is tax, not profit');
    assert.equal(a.sellerShare, 190);
    assert.equal(a.platformNetProfit, r2(5 + 30 + 20 - 25 - 20), 'the platform wears the coins');
});

await check('a platform-funded coupon leaves GST on the full price; a seller-funded one lowers it', async () => {
    const { applyCheckoutShare, sellerFundedShareOfCoupon } = await import('../src/modules/ecommerce/modules/commerce/orders/services/order-pricing.service.js');
    const { Offer } = await import('../src/modules/ecommerce/modules/commerce/admin/models/offer.model.js');
    await Offer.collection.insertMany([
        { couponCode: 'PLAT100', adminBearPercentage: 100, sellerBearPercentage: 0 },
        { couponCode: 'SELL100', adminBearPercentage: 0, sellerBearPercentage: 100 },
        { couponCode: 'HALF', adminBearPercentage: 50, sellerBearPercentage: 50 },
    ]);
    assert.equal(await sellerFundedShareOfCoupon('PLAT100'), 0);
    assert.equal(await sellerFundedShareOfCoupon('SELL100'), 1);
    assert.equal(await sellerFundedShareOfCoupon('HALF'), 0.5);

    // Rs 1000 of 18% goods, Rs 200 coupon.
    const items = [{ price: 1000, quantity: 1, gstRate: 18 }];
    const base = { subtotal: 1000, tax: 180, total: 1180 };
    const platform = applyCheckoutShare(base, items, { couponShare: 200, couponCode: 'PLAT100', sellerFundedShare: 0 });
    const seller = applyCheckoutShare(base, items, { couponShare: 200, couponCode: 'SELL100', sellerFundedShare: 1 });
    assert.equal(platform.tax, 180, 'tax on the full Rs 1000');
    assert.equal(platform.total, 980, 'the customer still saves the full Rs 200');
    assert.equal(seller.tax, 144, 'tax on Rs 800');
    assert.equal(seller.total, 944);
});

await mongoose.disconnect();
await mongo.stop();
if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll Shop ledger checks passed');
process.exit(0);
