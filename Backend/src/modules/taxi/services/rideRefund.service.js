import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Ride } from '../user/models/Ride.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { RIDE_STATUS } from '../constants/index.js';
import { resolveConfiguredGatewayCredentials } from './paymentGatewayService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

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

/** Razorpay refund through the taxi module's own gateway settings. */
const refundThroughRazorpay = async (paymentId, rupees, note) => {
  if (isMockPaymentAllowed() && paymentId.startsWith('mock_')) {
    return { refundId: `mock_rfnd_${Date.now()}` };
  }
  const { keyId, keySecret } = await resolveConfiguredGatewayCredentials('razor_pay');
  if (!keyId || !keySecret) throw new Error('Razorpay is not configured');
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: toPaise(rupees), notes: { reason: note.slice(0, 250) } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.description || `Razorpay answered ${response.status}`);
  }
  return { refundId: String(payload.id) };
};

/**
 * Refund a completed or cancelled paid ride.
 *
 * Claim, pay, record -- in that order, so nothing is paid twice. The claim is one
 * atomic update that sets adminRefund.status to 'pending' and reserves the amount
 * on adminRefund.refundedPaise, matched against the values just read; a second
 * refund started meanwhile finds neither matching and is refused. A payout that
 * fails gives the claim back. The rider is told only once the money has moved.
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

  const prev = ride.adminRefund || {};
  const prevStatus = prev.status || 'none';
  if (prevStatus === 'pending') throw new ApiError(409, 'A refund on this ride is already in progress. Refresh in a moment.');
  const rawCounter = Number.isFinite(prev.refundedPaise) ? prev.refundedPaise : null;
  const alreadyPaise = rawCounter ?? 0;
  const leftPaise = payment.paidPaise - alreadyPaise;
  if (leftPaise <= 0) throw new ApiError(400, 'Everything paid for this ride has already been refunded');

  const wantedPaise = amount === undefined || amount === null || amount === '' ? leftPaise : toPaise(amount);
  if (!(wantedPaise > 0)) throw new ApiError(400, 'Refund amount must be more than zero');
  if (wantedPaise > leftPaise) {
    throw new ApiError(400, `Refund cannot be more than Rs ${(leftPaise / 100).toFixed(2)}, what is left of the Rs ${(payment.paidPaise / 100).toFixed(2)} paid`);
  }

  const reservedPaise = alreadyPaise + wantedPaise;
  const claimed = await Ride.findOneAndUpdate(
    {
      _id: ride._id,
      'adminRefund.status': prevStatus === 'none' ? { $in: [null, 'none'] } : prevStatus,
      'adminRefund.refundedPaise': rawCounter,
    },
    { $set: { 'adminRefund.status': 'pending', 'adminRefund.refundedPaise': reservedPaise } },
    { new: true },
  );
  if (!claimed) throw new ApiError(409, 'Another refund on this ride is in progress or just finished. Refresh and try again.');

  const rupees = wantedPaise / 100;
  const shortId = String(ride._id).slice(-6);
  let refundId = '';
  try {
    if (payment.method === 'razorpay') {
      ({ refundId } = await refundThroughRazorpay(payment.paymentId, rupees, note));
    } else {
      const title = payment.method === 'cash'
        ? `Refund for ride ${shortId} (paid in cash, so credited to your wallet)`
        : `Refund for ride ${shortId}`;
      await UserWallet.findOneAndUpdate(
        { userId: ride.userId },
        {
          $inc: { balance: rupees },
          $push: {
            transactions: {
              $each: [{
                kind: 'credit',
                amount: rupees,
                title,
                description: title,
                provider: 'admin_ride_refund',
                referenceKey: `ride-refund:${ride._id}:${reservedPaise}`,
                metadata: { rideId: String(ride._id), byAdminId: String(adminId || ''), reason: note },
              }],
              $position: 0,
            },
          },
        },
        { upsert: true, new: true },
      );
    }
  } catch (err) {
    await Ride.updateOne(
      { _id: ride._id, 'adminRefund.status': 'pending', 'adminRefund.refundedPaise': reservedPaise },
      { $set: { 'adminRefund.status': prevStatus, 'adminRefund.refundedPaise': alreadyPaise } },
    );
    throw new ApiError(424, `The refund could not be paid (${err?.message || 'payout error'}). Nothing was refunded; try again.`);
  }

  const entry = {
    amount: rupees,
    method: payment.method === 'razorpay' ? 'razorpay' : 'wallet',
    refundId,
    reason: note,
    byAdminId: String(adminId || ''),
    at: new Date(),
  };
  await Ride.updateOne(
    { _id: ride._id },
    { $set: { 'adminRefund.status': 'processed' }, $push: { 'adminRefund.history': entry } },
  );

  // Only now, with the money moved and recorded, is the rider told.
  try {
    await sendPushNotificationToEntities({
      userIds: [String(ride.userId)],
      title: 'Refund processed',
      body: entry.method === 'razorpay'
        ? `Rs ${rupees.toFixed(2)} for your ride has been refunded to your original payment method within 5-7 working days.`
        : `Rs ${rupees.toFixed(2)} for your ride has been credited to your wallet.`,
      data: { type: 'ride_refund', rideId: String(ride._id) },
    });
  } catch {
    // A missed push must not turn a paid refund into an error for the admin.
  }

  return {
    rideId: String(ride._id),
    refund: { ...entry, refundedTotal: reservedPaise / 100, refundableLeft: (payment.paidPaise - reservedPaise) / 100 },
    message: entry.method === 'razorpay'
      ? `Rs ${rupees.toFixed(2)} refunded to the original payment (Razorpay ${refundId})`
      : `Rs ${rupees.toFixed(2)} credited to the rider's wallet`,
  };
};
