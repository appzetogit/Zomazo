import { CustomerWallet } from './customerWallet.model.js';
import { walletOwner } from './linkedWallet.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Credit the customer's ONE wallet once per `row.referenceKey`.
 *
 * For rewards the platform pays (cashback, top-up bonus, loyalty conversion),
 * from any service. `customerId` may be the service's own customer id (qc_users,
 * ecom_users) or the platform account; it is translated the way every wallet
 * move is (linkedWallet.js).
 *
 * The "not yet credited" check is the update's own filter, so a retried
 * delivery hook or a double-submitted verify cannot pay twice, and `$inc` with
 * `$push` lands in one step, so it never races another move on the wallet.
 * `guard` narrows the filter further (cashback also refuses an order the
 * service's older cashback code already paid).
 *
 * @returns {Promise<boolean>} true when this call credited the money
 */
export async function creditWalletOnce(customerId, row, { guard = {} } = {}) {
    const amount = round2(row?.amount);
    const key = String(row?.referenceKey || '');
    if (!(amount > 0) || !key) return false;
    const owner = await walletOwner(customerId);

    // The wallet has to exist before a conditional update can match it; an
    // upsert with the "not yet credited" filter would make a second wallet.
    try {
        await CustomerWallet.updateOne(
            { userId: owner },
            { $setOnInsert: { userId: owner, balance: 0, transactions: [] } },
            { upsert: true },
        );
    } catch (err) {
        if (err?.code !== 11000) throw err; // made by a concurrent move: fine
    }

    const res = await CustomerWallet.updateOne(
        { userId: owner, 'transactions.referenceKey': { $ne: key }, ...guard },
        {
            $inc: { balance: amount },
            $push: {
                transactions: {
                    $each: [{ type: 'addition', status: 'Completed', ...row, amount, referenceKey: key, createdAt: new Date() }],
                    $position: 0,
                },
            },
        },
    );
    return res.modifiedCount === 1;
}

/**
 * Take up to `amount` back, once per `referenceKey`, never below zero.
 * @returns {Promise<number>} what was actually taken
 */
export async function debitWalletOnce(customerId, row) {
    const key = String(row?.referenceKey || '');
    const owner = await walletOwner(customerId);
    const wallet = await CustomerWallet.findOne({ userId: owner }).select('balance').lean();
    const amount = Math.min(round2(row?.amount), round2(wallet?.balance));
    if (!(amount > 0) || !key) return 0;
    const res = await CustomerWallet.updateOne(
        { userId: owner, balance: { $gte: amount }, 'transactions.referenceKey': { $ne: key } },
        {
            $inc: { balance: -amount },
            $push: {
                transactions: {
                    $each: [{ type: 'deduction', status: 'Completed', ...row, amount, referenceKey: key, createdAt: new Date() }],
                    $position: 0,
                },
            },
        },
    );
    return res.modifiedCount === 1 ? amount : 0;
}
