/**
 * Move balances left in the Shop's old wallets onto each customer's ONE wallet.
 *
 * The Shop kept its own wallets (ecom_user_wallets, keyed by the Shop customer
 * id). It now uses the shared wallet (food_user_wallets, keyed by the platform
 * account -- core/wallet/linkedWallet.js), so anything still sitting in the old
 * collection is invisible until moved.
 *
 *   node scripts/moveShopWallets.mjs            # dry run: lists what would move
 *   node scripts/moveShopWallets.mjs --apply    # moves it
 *
 * Safe to run again, and safe to stop halfway: each move is one credit on the
 * shared wallet carrying a reference unique to that old wallet
 * ("shop-wallet-move:<id>"), and the credit is refused if the reference is
 * already there -- so an old wallet is never paid out twice. The old wallet is
 * then marked movedToSharedAt and left in place, history and all.
 *
 * Requires MONGO_URI (or MONGODB_URI).
 */
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('moveShopWallets: MONGO_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
const { platformUserIdFor } = await import('../src/core/identity/platformUser.js');
const db = mongoose.connection;
const oldWallets = db.collection('ecom_user_wallets');
const shared = db.collection('food_user_wallets');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
let moved = 0;
let skipped = 0;
let total = 0;

const cursor = oldWallets.find({ movedToSharedAt: { $in: [null, undefined] } });
for await (const w of cursor) {
  const balance = round2(w.balance);
  const referral = round2(w.referralEarnings);
  if (balance <= 0 && referral <= 0) {
    if (apply) await oldWallets.updateOne({ _id: w._id }, { $set: { movedToSharedAt: new Date(), movedNote: 'nothing to move' } });
    skipped += 1;
    continue;
  }

  const link = await platformUserIdFor(w.userId).catch(() => null);
  const owner = new mongoose.Types.ObjectId(link?.platformId || String(w.userId));
  const key = `shop-wallet-move:${w._id}`;
  console.log(`${apply ? 'moving' : 'would move'} Rs.${balance} (referral Rs.${referral}) from Shop customer ${w.userId} to wallet of ${owner}`);

  if (apply) {
    const now = new Date();
    try {
      await shared.updateOne(
        { userId: owner, 'transactions.referenceKey': { $ne: key } },
        {
          $inc: { balance, referralEarnings: referral },
          $push: {
            transactions: {
              $each: [{
                _id: new mongoose.Types.ObjectId(),
                type: 'addition',
                kind: 'credit',
                amount: balance,
                status: 'Completed',
                description: 'Shop wallet balance moved to your wallet',
                title: 'Shop wallet balance moved to your wallet',
                referenceKey: key,
                metadata: { source: 'shop_wallet_move', shopWalletId: String(w._id), referralEarnings: referral },
                createdAt: now,
                updatedAt: now,
              }],
              $position: 0,
            },
          },
          $setOnInsert: { refundWallet: 0, createdAt: now },
          $set: { updatedAt: now },
        },
        { upsert: true },
      );
    } catch (err) {
      // The wallet exists and already carries this reference: moved before.
      if (err?.code !== 11000) throw err;
    }
    await oldWallets.updateOne({ _id: w._id }, { $set: { movedToSharedAt: new Date(), movedTo: owner } });
  }
  moved += 1;
  total = round2(total + balance);
}

console.log(`\n${apply ? 'Moved' : 'Would move'} ${moved} wallet(s), Rs.${total} in all; ${skipped} empty.`);
if (!apply && moved) console.log('Run again with --apply to move them.');
await mongoose.disconnect();
process.exit(0);
