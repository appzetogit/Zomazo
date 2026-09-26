import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';
import { UserWallet } from '../models/userWallet.model.js';
import {
    createRazorpayOrder,
    fetchRazorpayOrder,
    fetchRazorpayPayment,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature
} from '../../orders/helpers/razorpay.helper.js';

const toUserOid = (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    return new mongoose.Types.ObjectId(id);
};

const ensureWallet = async (oid) => {
    const upsert = () => UserWallet.updateOne(
        { userId: oid },
        { $setOnInsert: { userId: oid, balance: 0, referralEarnings: 0, transactions: [] } },
        { upsert: true }
    );
    try {
        await upsert();
    } catch (err) {
        // Two first-ever writes for the same user race to insert; the loser hits the
        // unique index, and by then the wallet exists.
        if (err?.code !== 11000) throw err;
    }
};

/**
 * Every balance change goes through here, as one conditional update: the entry is
 * pushed and the balance moved in the same write, and `guard` is part of the match.
 * The old read-modify-save let two concurrent orders both pass the balance check,
 * and let concurrent credits overwrite each other's balance.
 *
 * Returns the updated wallet, or null when `guard` did not match.
 */
const applyWalletEntry = async (oid, entry, { guard = {}, inc = {} } = {}) => {
    await ensureWallet(oid);
    const now = new Date();
    const delta = entry.type === 'deduction' ? -entry.amount : entry.amount;
    return UserWallet.findOneAndUpdate(
        { userId: oid, ...guard },
        {
            $inc: { balance: delta, ...inc },
            $push: { transactions: { $each: [{ ...entry, createdAt: now, updatedAt: now }], $position: 0 } }
        },
        { new: true }
    );
};

export const creditReferralReward = async (userId, amountInr, metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }
    await applyWalletEntry(
        toUserOid(userId),
        {
            type: 'addition',
            amount,
            status: 'Completed',
            description: 'Referral reward',
            metadata: { source: 'referral_reward', ...(metadata || {}) }
        },
        { inc: { referralEarnings: amount } }
    );
    return { wallet: await getUserWallet(userId) };
};

/**
 * Credit cashback for a delivered order, at most once per order.
 * Returns false when this order's cashback was already credited.
 */
export const creditCashback = async (userId, amountInr, order) => {
    const amount = Math.round((Number(amountInr) || 0) * 100) / 100;
    if (amount <= 0) return false;
    const orderId = String(order._id);
    const updated = await applyWalletEntry(
        toUserOid(userId),
        {
            type: 'addition',
            amount,
            status: 'Completed',
            description: `Cashback on order ${order.order_id || order._id}`,
            metadata: {
                source: 'cashback',
                orderId,
                orderDisplayId: order.order_id || orderId
            }
        },
        { guard: { transactions: { $not: { $elemMatch: { 'metadata.source': 'cashback', 'metadata.orderId': orderId } } } } }
    );
    return Boolean(updated);
};

export const getUserWallet = async (userId) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const oid = new mongoose.Types.ObjectId(id);
    const wallet = await UserWallet.findOne({ userId: oid });
    if (!wallet) {
        return { balance: 0, referralEarnings: 0, transactions: [] };
    }
    // Return newest first (UI expects recent transactions on top)
    const tx = Array.isArray(wallet.transactions) ? [...wallet.transactions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
    return {
        balance: Number(wallet.balance) || 0,
        referralEarnings: Number(wallet.referralEarnings) || 0,
        transactions: tx.map((t) => ({
            id: String(t._id),
            _id: t._id,
            type: t.type,
            amount: Number(t.amount) || 0,
            status: t.status || 'Completed',
            description: t.description || '',
            date: t.createdAt,
            createdAt: t.createdAt,
            metadata: t.metadata || {}
        }))
    };
};

const TOPUP_PURPOSE = 'wallet_topup';
const topupReceiptPrefix = (userId) => `wallet_topup_${String(userId).slice(-8)}_`;

// Without Razorpay keys a top-up is credited unverified, which is only acceptable
// on a developer's machine. A production server missing its keys must refuse.
const allowUnverifiedTopup = () => !isRazorpayConfigured() && config.nodeEnv !== 'production';

export const createWalletTopupOrder = async (userId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0');
    }
    if (amount > 50000) {
        throw new ValidationError('Maximum amount is 50,000');
    }

    const amountPaise = Math.round(amount * 100);

    if (!isRazorpayConfigured()) {
        if (!allowUnverifiedTopup()) {
            throw new ValidationError('Online payment is not available right now');
        }
        // Dev fallback: return a compatible shape without writing to DB.
        const orderId = `order_dev_${Date.now()}`;
        return {
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId,
                amount: amountPaise,
                currency: 'INR'
            }
        };
    }

    const receipt = `${topupReceiptPrefix(userId)}${Date.now()}`;
    const order = await createRazorpayOrder(amountPaise, 'INR', receipt, {
        purpose: TOPUP_PURPOSE,
        userId: String(userId)
    });

    return {
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR'
        }
    };
};

/**
 * Work out how much a verified Razorpay payment is worth as a top-up for this user.
 *
 * The signature proves the payment belongs to the order and nothing more. So the
 * amount comes from Razorpay, not the client (which could pay Rs 1 and claim 50,000),
 * and the order must be a wallet top-up created for this user — otherwise the
 * payment for a food order could be replayed here and paid out a second time.
 */
const resolveVerifiedTopupAmount = async (userId, orderId, paymentId, claimedAmount) => {
    const [rzOrder, payment] = await Promise.all([
        fetchRazorpayOrder(orderId),
        fetchRazorpayPayment(paymentId)
    ]);

    const notes = rzOrder?.notes || {};
    const isThisUsersTopup = notes.purpose
        ? notes.purpose === TOPUP_PURPOSE && String(notes.userId) === String(userId)
        // Orders created before notes were added carry the user in the receipt.
        : String(rzOrder?.receipt || '').startsWith(topupReceiptPrefix(userId));
    if (!isThisUsersTopup) {
        throw new ValidationError('This payment is not a wallet top-up');
    }

    if (payment?.order_id && String(payment.order_id) !== orderId) {
        throw new ValidationError('Payment does not belong to this order');
    }
    if (!['captured', 'authorized'].includes(String(payment?.status || ''))) {
        throw new ValidationError(`Payment is not captured (status: ${payment?.status || 'unknown'})`);
    }
    const paidPaise = Number(payment?.amount);
    if (!Number.isFinite(paidPaise) || paidPaise <= 0) {
        throw new ValidationError('Could not confirm the paid amount with Razorpay');
    }

    const paid = Math.round(paidPaise) / 100;
    if (Number.isFinite(claimedAmount) && Math.abs(paid - claimedAmount) > 0.01) {
        logger.warn(
            `Wallet top-up amount mismatch for user ${userId}: client claimed ${claimedAmount}, Razorpay captured ${paid}. Crediting the captured amount.`
        );
    }
    return paid;
};

export const verifyWalletTopupPayment = async (userId, payload) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const claimedAmount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');

    const oid = toUserOid(userId);
    const alreadyCredited = await UserWallet.exists({ userId: oid, 'transactions.razorpayOrderId': orderId });
    if (alreadyCredited) {
        return { wallet: await getUserWallet(userId) };
    }

    let amount;
    if (allowUnverifiedTopup()) {
        if (!Number.isFinite(claimedAmount) || claimedAmount <= 0) throw new ValidationError('amount is required');
        amount = claimedAmount;
    } else {
        if (!isRazorpayConfigured() || !verifyPaymentSignature(orderId, paymentId, signature)) {
            throw new ValidationError('Payment verification failed');
        }
        amount = await resolveVerifiedTopupAmount(userId, orderId, paymentId, claimedAmount);
    }

    // The guard makes a retried or double-submitted verify a no-op instead of a
    // second credit for the same Razorpay order.
    await applyWalletEntry(
        oid,
        {
            type: 'addition',
            amount,
            status: 'Completed',
            description: isRazorpayConfigured() ? 'Wallet top-up' : 'Wallet top-up (dev)',
            metadata: { source: 'wallet_topup', mode: isRazorpayConfigured() ? 'razorpay' : 'dev' },
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature
        },
        { guard: { 'transactions.razorpayOrderId': { $ne: orderId } } }
    );

    return { wallet: await getUserWallet(userId) };
};

export const deductWalletBalance = async (userId, amountInr, description = 'Order payment', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Invalid deduction amount');
    }

    const updated = await applyWalletEntry(
        toUserOid(userId),
        {
            type: 'deduction',
            amount,
            status: 'Completed',
            description,
            metadata: { source: 'order_payment', ...(metadata || {}) }
        },
        { guard: { balance: { $gte: amount } } }
    );
    if (!updated) {
        throw new ValidationError('Insufficient wallet balance');
    }

    return { wallet: await getUserWallet(userId) };
};

export const refundWalletBalance = async (userId, amountInr, description = 'Order refund', metadata = {}) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { wallet: await getUserWallet(userId) };
    }

    // An order is refunded once. Two cancellations racing each other (the customer
    // and the acceptance timeout, say) each load the order before either saves, so
    // the check on the order document cannot stop the second credit; this can.
    const orderId = metadata?.orderId;
    const guard = orderId
        ? { transactions: { $not: { $elemMatch: { 'metadata.source': 'order_refund', 'metadata.orderId': orderId } } } }
        : {};

    const updated = await applyWalletEntry(
        toUserOid(userId),
        {
            type: 'refund',
            amount,
            status: 'Completed',
            description,
            metadata: { source: 'order_refund', ...(metadata || {}) }
        },
        { guard }
    );
    if (!updated && orderId) {
        logger.warn(`Skipped a second wallet refund for order ${orderId}`);
    }

    return { wallet: await getUserWallet(userId) };
};
