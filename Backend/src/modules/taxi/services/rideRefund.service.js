import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Ride } from '../user/models/Ride.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { RIDE_STATUS } from '../constants/index.js';
import { resolveConfiguredGatewayCredentials } from './paymentGatewayService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';
import { applyUserWalletAdjustment } from './dispatchService.js';
import { runAdminRefund } from '../../../core/orders/adminRefundClaim.js';

/*
 * Admin refunds on rides.
 *
 * A ride had no way to give money back: a rider overcharged on a completed ride,
 * or charged on one that was then cancelled, could only be helped with a manual
 * wallet adjustment that recorded nothing against the ride and had no cap. This
 * refunds the ride itself -- full or partial, any number of times, never more in
 * total than was paid -- and keeps each refund on the ride.
 */

const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const PAID_COLLECTION = new Set(['paid', 'captured', 'completed']);
// Same switch the rider's payment verification uses (user/controllers/rideController.js).
const isMockPaymentAllowed = () => process.env.NODE_ENV !== 'production';

/**
 * What the rider paid for this ride and how, or null when nothing was paid.
 *
 * Online and wallet payments are the server's own verified record on
 * driverPaymentCollection. A completed cash ride was paid in cash to the driver:
 * the fare, which the app cannot hand back, so it is refunded to the wallet.
 */
export const ridePaymentOf = (ride) => {
  const collection = ride.driverPaymentCollection || {};
  const provider = String(collection.provider || '').toLowerCase();
  const paymentId = String(collection.providerPaymentId || '').trim();
  if (PAID_COLLECTION.has(String(collection.status || '').toLowerCase()) && Number(collection.amount) > 0) {
    if (provider.includes('razorpay') && paymentId) {
      return { paidPaise: toPaise(collection.amount), method: 'razorpay', paymentId };
    }
    if (provider === 'wallet') return { paidPaise: toPaise(collection.amount), method: 'wallet' };
    if (provider === 'cash' || String(ride.paymentMethod || 'cash').toLowerCase() === 'cash') {
      return { paidPaise: toPaise(collection.amount), method: 'cash' };
    }
    // An online collection with no payment id cannot be traced back to the gateway.
    return { paidPaise: toPaise(collection.amount), method: 'unknown' };
  }
  if (ride.status === RIDE_STATUS.COMPLETED && String(ride.paymentMethod || 'cash').toLowerCase() === 'cash' && Number(ride.fare) > 0) {
    return { paidPaise: toPaise(ride.fare), method: 'cash' };
  }
  return null;
};

const razorpayAuth = async () => {
  const { keyId, keySecret } = await resolveConfiguredGatewayCredentials('razor_pay');
  if (!keyId || !keySecret) throw new Error('Razorpay is not configured');
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
};

/**
 * Razorpay refund through the taxi module's own gateway settings, tagged with the
 * claim key (receipt + notes) so findRazorpayRefund can find it again.
 */
const refundThroughRazorpay = async (paymentId, rupees, note, key) => {
  if (isMockPaymentAllowed() && paymentId.startsWith('mock_')) {
    return { refundId: `mock_rfnd_${Date.now()}` };
  }
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { Authorization: await razorpayAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: toPaise(rupees), receipt: key.slice(0, 40), notes: { reason: note.slice(0, 250), refund_key: key } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.description || `Razorpay answered ${response.status}`);
  }
  return { refundId: String(payload.id) };
};

/** A refund already made on this payment under `key`, or null. Throws if Razorpay cannot be asked. */
const findRazorpayRefund = async (paymentId, key) => {
  if (isMockPaymentAllowed() && paymentId.startsWith('mock_')) return null;
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refunds?count=100`, {
    headers: { Authorization: await razorpayAuth() },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.description || `Razorpay answered ${response.status}`);
  const hit = (payload.items || []).find((r) => r?.notes?.refund_key === key || r?.receipt === key.slice(0, 40));
  return hit ? { refundId: String(hit.id) } : null;
};

/**
 * Refund a completed or cancelled paid ride.
 *
 * Claim, pay, record through core/orders/adminRefundClaim.js on ride.adminRefund:
 * one atomic claim so two refunds cannot both pay; a claim a crash left behind is
 * taken over after ten minutes and its payout looked up by key before anything is
 * paid again. The rider is told only once the money has moved.
 *
 * Wallet refunds follow taxi's own convention for money returned on a ride
 * (dispatchService's cancellation compensation): credited to the wallet's
 * refundWallet, as a credit row with a referenceKey -- which is also what makes
 * the credit idempotent and findable after a crash.
 *
 * @param {string} rideId
 * @param {{amount?: number|string, reason: string, adminId?: string}} opts
 *   amount omitted = everything still refundable
 */
export const refundRideByAdmin = async (rideId, { amount, reason, adminId } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) throw new ApiError(400, 'Invalid ride id');
  const note = String(reason || '').trim();
  if (note.length < 4) throw new ApiError(400, 'Give a reason for the refund (at least 4 characters)');

  const ride = await Ride.findById(rideId).lean();
  if (!ride) throw new ApiError(404, 'Ride not found');
  if (ride.status !== RIDE_STATUS.COMPLETED && ride.status !== RIDE_STATUS.CANCELLED) {
    throw new ApiError(400, 'Only a completed or cancelled ride can be refunded');
  }

  const payment = ridePaymentOf(ride);
  if (!payment) throw new ApiError(400, 'Nothing was paid for this ride, so there is nothing to refund');
  if (payment.method === 'unknown') {
    throw new ApiError(400, 'This online payment has no gateway reference, so it cannot be refunded to where it came from');
  }

  const shortId = String(ride._id).slice(-6);
  const walletRef = (key) => `ride-admin-refund:${ride._id}:${key}`;
  const method = payment.method === 'razorpay' ? 'razorpay' : 'wallet';
  const { entry, totalPaise } = await runAdminRefund({
    Model: Ride,
    docId: ride._id,
    paths: {
      status: 'adminRefund.status',
      counter: 'adminRefund.refundedPaise',
      claim: 'adminRefund.claim',
      history: 'adminRefund.history',
    },
    paidPaise: payment.paidPaise,
    amount,
    meta: { method, reason: note, byAdminId: String(adminId || '') },
    // The refund's share of the ride's cashback and points goes back with it.
    rewards: { service: 'taxi', customerId: ride.userId, orderId: ride._id },
    pay: async ({ rupees, key }) => {
      if (method === 'razorpay') return refundThroughRazorpay(payment.paymentId, rupees, note, key);
      const result = await applyUserWalletAdjustment({
        userId: ride.userId,
        amount: rupees,
        kind: 'credit',
        title: payment.method === 'cash'
          ? `Refund for ride ${shortId} (paid in cash, so credited to your wallet)`
          : `Refund for ride ${shortId}`,
        referenceKey: walletRef(key),
        walletField: 'refundWallet',
        provider: 'ride_admin_refund',
      });
      if (!['applied', 'existing'].includes(result.status)) throw new Error(`wallet credit ${result.status}`);
      return {};
    },
    findPaid: async (claim) => {
      if (method === 'razorpay') return findRazorpayRefund(payment.paymentId, claim.key);
      const hit = await UserWallet.exists({ userId: ride.userId, 'transactions.referenceKey': walletRef(claim.key) });
      return hit ? {} : null;
    },
  }).catch((err) => {
    throw new ApiError(err.statusCode || 500, err.message);
  });

  const rupees = entry.amount;
  // Only now, with the money moved and recorded, is the rider told.
  try {
    await sendPushNotificationToEntities({
      userIds: [String(ride.userId)],
      title: 'Refund processed',
      body: method === 'razorpay'
        ? `Rs ${rupees.toFixed(2)} for your ride has been refunded to your original payment method within 5-7 working days.`
        : `Rs ${rupees.toFixed(2)} for your ride has been credited to your wallet.`,
      data: { type: 'ride_refund', rideId: String(ride._id) },
    });
  } catch {
    // A missed push must not turn a paid refund into an error for the admin.
  }

  return {
    rideId: String(ride._id),
    refund: { ...entry, refundedTotal: totalPaise / 100, refundableLeft: (payment.paidPaise - totalPaise) / 100 },
    message: method === 'razorpay'
      ? `Rs ${rupees.toFixed(2)} refunded to the original payment (Razorpay ${entry.refundId})`
      : `Rs ${rupees.toFixed(2)} credited to the rider's wallet`,
  };
};
