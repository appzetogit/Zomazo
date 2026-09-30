import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { PromoCode } from '../admin/promotions/models/PromoCode.js';
import { PromoRedemption } from '../admin/promotions/models/PromoRedemption.js';
import { PromoUserCounter } from '../admin/promotions/models/PromoUserCounter.js';
import { Ride } from '../user/models/Ride.js';
import { effectivePromoLimits } from '../../../core/finance/promoLimits.service.js';
import { claimPlatformCoupon, listPlatformCouponsFor, quotePlatformCoupon } from '../../../core/promotions/platformCoupon.service.js';

const normalizeText = (value) => String(value ?? '').trim();

export const normalizePromoCode = (value) => normalizeText(value).toUpperCase();

const normalizeTransportType = (value) => {
  const normalized = normalizeText(value || 'taxi').toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'texi') return 'taxi';
  if (normalized === 'selfdrive') return 'self_drive';
  return normalized || 'taxi';
};

const toObjectIdOrThrow = (value, fieldName = 'id') => {
  if (!mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getPromoServiceLocationIds = (promo) => {
  const locationIds = Array.isArray(promo?.service_location_ids) && promo.service_location_ids.length > 0
    ? promo.service_location_ids
    : promo?.service_location_id
      ? [promo.service_location_id]
      : [];

  return [...new Set(locationIds.map((value) => String(value || '').trim()).filter(Boolean))];
};

const getPromoAudienceType = (promo) => {
  const normalized = normalizeText(promo?.audience_type).toLowerCase().replace(/\s+/g, '_');
  if (['all', 'specific_user', 'new_users'].includes(normalized)) {
    return normalized;
  }

  if (promo?.user_specific === true) {
    return 'specific_user';
  }

  return 'all';
};

const isUserEligibleForPromoAudience = async ({ promo, userId }) => {
  const audienceType = getPromoAudienceType(promo);

  if (audienceType === 'specific_user') {
    if (!userId) {
      return { eligible: false, reason: 'USER_REQUIRED', message: 'User is required for this promo code' };
    }
    if (String(promo.user_id || '') !== String(userId)) {
      return { eligible: false, reason: 'USER_MISMATCH', message: 'Promo code is not valid for this user' };
    }
    return { eligible: true, audienceType };
  }

  if (audienceType === 'new_users') {
    if (!userId) {
      return { eligible: false, reason: 'USER_REQUIRED', message: 'User is required for this promo code' };
    }

    // ponytail: "new user" = no COMPLETED rides. Counting any ride (incl. searching/cancelled)
    // permanently locked out users whose only prior ride auto-cancelled while unmatched.
    const hasCompletedRide = await Ride.exists({ userId: toObjectIdOrThrow(userId, 'user id'), status: 'completed' });
    if (hasCompletedRide) {
      return { eligible: false, reason: 'NEW_USERS_ONLY', message: 'Promo code is only valid for new users' };
    }
  }

  return { eligible: true, audienceType };
};

export const computePromoDiscount = ({ fare, promo, userCounter }) => {
  const safeFare = Number(fare);
  if (!Number.isFinite(safeFare) || safeFare < 0) {
    throw new ApiError(400, 'fare must be a positive number or zero');
  }

  const discountPercentage = clamp(Number(promo?.discount_percentage || 0), 0, 100);
  const rawDiscount = safeFare * (discountPercentage / 100);
  const maximumDiscountAmount = Math.max(0, Number(promo?.maximum_discount_amount || 0));

  const cappedDiscount = maximumDiscountAmount > 0 ? Math.min(rawDiscount, maximumDiscountAmount) : rawDiscount;

  const cumulativeCap = Math.max(0, Number(promo?.cumulative_max_discount_amount || 0));
  const usedCumulative = Math.max(0, Number(userCounter?.cumulative_discount_amount || 0));
  const remainingCumulative = cumulativeCap > 0 ? Math.max(0, cumulativeCap - usedCumulative) : null;

  const finalDiscount = remainingCumulative !== null ? Math.min(cappedDiscount, remainingCumulative) : cappedDiscount;
  const fareAfter = Math.max(0, safeFare - finalDiscount);

  return {
    fare_before_discount: safeFare,
    raw_discount: rawDiscount,
    capped_discount: cappedDiscount,
    discount_amount: finalDiscount,
    fare_after_discount: fareAfter,
    caps: {
      maximum_discount_amount: maximumDiscountAmount,
      cumulative_max_discount_amount: cumulativeCap,
      cumulative_used: usedCumulative,
      cumulative_remaining: remainingCumulative,
    },
    discount_percentage: discountPercentage,
  };
};

/**
 * A platform coupon (made in Master for several services) as a Taxi discount
 * breakdown, or null when no platform coupon has this code. Rides customers are
 * platform accounts already (users), so their id counts the uses directly; their
 * first ride is their first order.
 */
const quotePlatformPromo = async ({ code, userId, fare, session = null }) => {
  const safeFare = Number(fare);
  const validUser = userId && mongoose.isValidObjectId(userId);
  const isFirstOrder = validUser
    ? (await Ride.countDocuments({ userId: new mongoose.Types.ObjectId(String(userId)), status: { $ne: 'cancelled' } }).session(session)) === 0
    : null;
  const quoted = await quotePlatformCoupon(code, {
    service: 'taxi',
    platformUserId: validUser ? userId : null,
    subtotal: Number.isFinite(safeFare) ? safeFare : 0,
    isFirstOrder,
  });
  if (!quoted.coupon) return null;
  const coupon = quoted.coupon;
  const discount = Number(quoted.discount) || 0;
  return {
    quoted,
    breakdown: {
      fare_before_discount: safeFare,
      raw_discount: discount,
      capped_discount: discount,
      discount_amount: discount,
      fare_after_discount: Math.max(0, safeFare - discount),
      caps: {
        maximum_discount_amount: Number(coupon.maxDiscount) || 0,
        cumulative_max_discount_amount: 0,
        cumulative_used: 0,
        cumulative_remaining: null,
      },
      discount_percentage: coupon.discountType === 'percentage' ? Number(coupon.discountValue) || 0 : 0,
    },
  };
};

export const validatePromoForContext = async ({
  code,
  userId,
  fare,
  service_location_id,
  transport_type = 'taxi',
  now = new Date(),
}) => {
  const normalizedCode = normalizePromoCode(code);
  if (!normalizedCode) {
    return { eligible: false, reason: 'CODE_REQUIRED', message: 'Promo code is required' };
  }

  const promo = await PromoCode.findOne({ code: normalizedCode }).lean();
  if (!promo) {
    const platform = await quotePlatformPromo({ code: normalizedCode, userId, fare });
    if (!platform) return { eligible: false, reason: 'NOT_FOUND', message: 'Promo code not found' };
    if (!(platform.breakdown.discount_amount > 0)) {
      return { eligible: false, reason: 'PLATFORM_COUPON', message: platform.quoted.reason || 'Promo code cannot be used here' };
    }
    const coupon = platform.quoted.coupon;
    return {
      eligible: true,
      promo: {
        _id: coupon._id,
        code: coupon.code,
        platform: true,
        minimum_trip_amount: Number(coupon.minOrderValue) || 0,
        maximum_discount_amount: Number(coupon.maxDiscount) || 0,
        discount_percentage: platform.breakdown.discount_percentage,
        uses_per_user: Number(coupon.perUserLimit) || 0,
        max_uses_total: Number(coupon.usageLimit) || 0,
        usage_count: Number(coupon.usedCount) || 0,
        active: coupon.status === 'active',
        from_date: coupon.startDate,
        to_date: coupon.endDate,
      },
      breakdown: platform.breakdown,
    };
  }

  const transportType = normalizeTransportType(transport_type);
  const serviceLocationId = service_location_id ? String(service_location_id) : '';
  const promoServiceLocationIds = getPromoServiceLocationIds(promo);

  if (promo.active === false) {
    return { eligible: false, reason: 'INACTIVE', message: 'Promo code is inactive' };
  }

  if (promo.from_date && now < new Date(promo.from_date)) {
    return { eligible: false, reason: 'NOT_STARTED', message: 'Promo code is not active yet' };
  }

  if (promo.to_date && now > new Date(promo.to_date)) {
    return { eligible: false, reason: 'EXPIRED', message: 'Promo code has expired' };
  }

  if (!serviceLocationId) {
    return { eligible: false, reason: 'SERVICE_LOCATION_REQUIRED', message: 'service_location_id is required' };
  }

  if (promoServiceLocationIds.length > 0 && !promoServiceLocationIds.includes(serviceLocationId)) {
    return {
      eligible: false,
      reason: 'SERVICE_LOCATION_MISMATCH',
      message: 'Promo code is not valid for this service location',
    };
  }

  if (promo.transport_type && promo.transport_type !== 'all' && promo.transport_type !== transportType) {
    return { eligible: false, reason: 'TRANSPORT_TYPE_MISMATCH', message: 'Promo code is not valid for this transport type' };
  }

  const audienceEligibility = await isUserEligibleForPromoAudience({ promo, userId });
  if (!audienceEligibility.eligible) {
    return audienceEligibility;
  }

  const minimumTripAmount = Math.max(0, Number(promo.minimum_trip_amount || 0));
  const safeFare = Number(fare);
  if (!Number.isFinite(safeFare) || safeFare < 0) {
    return { eligible: false, reason: 'INVALID_FARE', message: 'fare must be a positive number or zero' };
  }
  if (safeFare < minimumTripAmount) {
    return { eligible: false, reason: 'MIN_TRIP', message: `Minimum trip amount is ${minimumTripAmount}` };
  }

  const [userCounter, promoFresh] = await Promise.all([
    userId && mongoose.isValidObjectId(userId)
      ? PromoUserCounter.findOne({ promo_id: promo._id, user_id: toObjectIdOrThrow(userId, 'user id') }).lean()
      : Promise.resolve(null),
    PromoCode.findById(promo._id).select('usage_count max_uses_total uses_per_user').lean(),
  ]);

  /*
   * The code's own limits, then the platform ceiling from Master > Promotions
   * applied over them. `tighten` never loosens, so a code allowing fewer uses
   * than the ceiling keeps its own number. Null means unlimited.
   */
  const ownTotal = Math.max(0, Number(promoFresh?.max_uses_total || promo.max_uses_total || 0));
  const ownPerUser = Math.max(1, Number(promoFresh?.uses_per_user || promo.uses_per_user || 1));
  const limits = await effectivePromoLimits({ vertical: 'taxi', ownPerUser, ownTotal });

  const usageCount = Math.max(0, Number(promoFresh?.usage_count || promo.usage_count || 0));
  if (limits.total !== null && usageCount >= limits.total) {
    return { eligible: false, reason: 'MAX_USES_REACHED', message: 'Promo code usage limit reached' };
  }

  const userUses = Math.max(0, Number(userCounter?.uses_count || 0));
  if (userId && limits.perUser !== null && userUses >= limits.perUser) {
    return { eligible: false, reason: 'USER_MAX_USES_REACHED', message: 'Promo code usage limit reached for user' };
  }

  const breakdown = computePromoDiscount({ fare: safeFare, promo, userCounter });
  if (breakdown.discount_amount <= 0) {
    return { eligible: false, reason: 'NO_DISCOUNT', message: 'Promo code does not provide a discount for this fare' };
  }

  return {
    eligible: true,
    promo: {
      _id: promo._id,
      code: promo.code,
      service_location_id: promo.service_location_id,
      service_location_ids: promoServiceLocationIds,
      transport_type: promo.transport_type,
      user_specific: getPromoAudienceType(promo) === 'specific_user',
      audience_type: audienceEligibility.audienceType,
      user_id: promo.user_id || '',
      minimum_trip_amount: Number(promo.minimum_trip_amount || 0),
      maximum_discount_amount: Number(promo.maximum_discount_amount || 0),
      cumulative_max_discount_amount: Number(promo.cumulative_max_discount_amount || 0),
      discount_percentage: Number(promo.discount_percentage || 0),
      // What is actually enforced, which is the code's own limit or the
      // platform ceiling, whichever is smaller. 0 = unlimited, as before.
      uses_per_user: limits.perUser === null ? 0 : limits.perUser,
      max_uses_total: limits.total === null ? 0 : limits.total,
      usage_count: Number(usageCount || 0),
      active: promo.active !== false,
      from_date: promo.from_date,
      to_date: promo.to_date,
    },
    breakdown,
  };
};

export const applyPromoToRideInTransaction = async ({
  session,
  ride,
  userId,
  code,
  fare,
  service_location_id,
  transport_type = 'taxi',
  surgeAmount = 0,
}) => {
  const normalizedCode = normalizePromoCode(code);
  if (!normalizedCode) {
    throw new ApiError(400, 'Promo code is required');
  }
  if (!service_location_id) {
    throw new ApiError(400, 'service_location_id is required when applying promo');
  }
  if (!userId) {
    throw new ApiError(400, 'User is required when applying promo');
  }

  const transportType = normalizeTransportType(transport_type);
  const serviceLocationId = toObjectIdOrThrow(service_location_id, 'service location id');
  const userObjectId = toObjectIdOrThrow(userId, 'user id');

  const promo = await PromoCode.findOne({ code: normalizedCode }).session(session);
  if (!promo) {
    // A platform coupon: priced like a Taxi promo, claimed inside this booking's
    // transaction so an aborted or retried booking never keeps a claim.
    const platform = await quotePlatformPromo({ code: normalizedCode, userId, fare, session });
    if (!platform) throw new ApiError(404, 'Promo code not found');
    if (!(platform.breakdown.discount_amount > 0)) {
      throw new ApiError(400, platform.quoted.reason || 'Promo code cannot be used here');
    }
    const claim = await claimPlatformCoupon(normalizedCode, { service: 'taxi', platformUserId: userObjectId, session });
    if (!claim.taken) {
      throw new ApiError(409, claim.perUser ? 'Promo code usage limit reached for user' : 'Promo code usage limit reached');
    }
    const breakdown = platform.breakdown;
    ride.promo = {
      code: normalizedCode,
      promo_id: null,
      discount_amount: breakdown.discount_amount,
      fare_before_discount: breakdown.fare_before_discount,
      fare_after_discount: breakdown.fare_after_discount,
      service_location_id: serviceLocationId,
      transport_type: transportType,
      applied_at: new Date(),
    };
    ride.fare = breakdown.fare_after_discount + Math.max(0, Number(surgeAmount || 0));
    await ride.save({ session });
    return { promo: { code: normalizedCode, platform: true }, breakdown };
  }

  const now = new Date();
  if (promo.active === false) {
    throw new ApiError(400, 'Promo code is inactive');
  }
  if (promo.from_date && now < promo.from_date) {
    throw new ApiError(400, 'Promo code is not active yet');
  }
  if (promo.to_date && now > promo.to_date) {
    throw new ApiError(400, 'Promo code has expired');
  }

  const promoServiceLocationIds = getPromoServiceLocationIds(promo);
  if (promoServiceLocationIds.length > 0 && !promoServiceLocationIds.includes(String(serviceLocationId))) {
    throw new ApiError(400, 'Promo code is not valid for this service location');
  }

  if (promo.transport_type !== 'all' && promo.transport_type !== transportType) {
    throw new ApiError(400, 'Promo code is not valid for this transport type');
  }

  const audienceEligibility = await isUserEligibleForPromoAudience({ promo, userId });
  if (!audienceEligibility.eligible) {
    throw new ApiError(400, audienceEligibility.message);
  }

  const safeFare = Number(fare);
  const minimumTripAmount = Math.max(0, Number(promo.minimum_trip_amount || 0));
  if (!Number.isFinite(safeFare) || safeFare < 0) {
    throw new ApiError(400, 'fare must be a positive number or zero');
  }
  if (safeFare < minimumTripAmount) {
    throw new ApiError(400, `Minimum trip amount is ${minimumTripAmount}`);
  }

  // Same ceiling as the quote path, so a redemption cannot succeed on terms the
  // quote would have refused.
  const redeemLimits = await effectivePromoLimits({
    vertical: 'taxi',
    ownPerUser: Math.max(1, Number(promo.uses_per_user || 1)),
    ownTotal: Math.max(0, Number(promo.max_uses_total || 0)),
  });
  const maxUsesTotal = redeemLimits.total === null ? 0 : redeemLimits.total;
  const usesPerUser = redeemLimits.perUser === null ? 0 : redeemLimits.perUser;

  if (maxUsesTotal > 0 && Number(promo.usage_count || 0) >= maxUsesTotal) {
    throw new ApiError(409, 'Promo code usage limit reached');
  }

  const userCounter = await PromoUserCounter.findOne({ promo_id: promo._id, user_id: userObjectId }).session(session);
  if (userCounter && usesPerUser > 0 && Number(userCounter.uses_count || 0) >= usesPerUser) {
    throw new ApiError(409, 'Promo code usage limit reached for user');
  }

  const breakdown = computePromoDiscount({ fare: safeFare, promo, userCounter });
  if (breakdown.discount_amount <= 0) {
    throw new ApiError(400, 'Promo code does not provide a discount for this fare');
  }

  const promoUpdateQuery = { _id: promo._id };
  if (maxUsesTotal > 0) {
    promoUpdateQuery.usage_count = { $lt: maxUsesTotal };
  }

  const promoUpdated = await PromoCode.findOneAndUpdate(promoUpdateQuery, { $inc: { usage_count: 1 } }, { returnDocument: 'after', session });
  if (!promoUpdated) {
    throw new ApiError(409, 'Promo code usage limit reached');
  }

  const cumulativeCap = Math.max(0, Number(promo.cumulative_max_discount_amount || 0));
  const cumulativeCeiling = cumulativeCap > 0 ? cumulativeCap - breakdown.discount_amount : null;

  if (!userCounter) {
    if (cumulativeCap > 0 && breakdown.discount_amount > cumulativeCap) {
      throw new ApiError(409, 'Promo code cumulative discount cap reached for user');
    }

    await PromoUserCounter.create(
      [
        {
          promo_id: promo._id,
          user_id: userObjectId,
          uses_count: 1,
          cumulative_discount_amount: breakdown.discount_amount,
        },
      ],
      { session },
    );
  } else {
    // 0 is unlimited, and `$lt: 0` matches nothing -- which would refuse every
    // redemption of an uncapped code rather than allowing them.
    const counterQuery = { _id: userCounter._id };
    if (usesPerUser > 0) counterQuery.uses_count = { $lt: usesPerUser };
    if (cumulativeCeiling !== null) {
      counterQuery.cumulative_discount_amount = { $lte: cumulativeCeiling };
    }

    const counterUpdated = await PromoUserCounter.findOneAndUpdate(
      counterQuery,
      { $inc: { uses_count: 1, cumulative_discount_amount: breakdown.discount_amount } },
      { returnDocument: 'after', session },
    );

    if (!counterUpdated) {
      throw new ApiError(409, 'Promo code usage limit reached for user');
    }
  }

  await PromoRedemption.create(
    [
      {
        promo_id: promo._id,
        code: promo.code,
        user_id: userObjectId,
        ride_id: ride._id,
        service_location_id: serviceLocationId,
        transport_type: promo.transport_type || transportType,
        fare_before_discount: breakdown.fare_before_discount,
        discount_amount: breakdown.discount_amount,
        fare_after_discount: breakdown.fare_after_discount,
        discount_percentage_snapshot: breakdown.discount_percentage,
        maximum_discount_amount_snapshot: breakdown.caps.maximum_discount_amount,
        cumulative_max_discount_amount_snapshot: breakdown.caps.cumulative_max_discount_amount,
        uses_per_user_snapshot: usesPerUser,
        max_uses_total_snapshot: maxUsesTotal,
        status: 'applied',
        idempotency_key: normalizeText(`ride:${ride._id}:promo:${promo._id}`),
      },
    ],
    { session },
  );

  ride.promo = {
    code: promo.code,
    promo_id: promo._id,
    discount_amount: breakdown.discount_amount,
    fare_before_discount: breakdown.fare_before_discount,
    fare_after_discount: breakdown.fare_after_discount,
    service_location_id: serviceLocationId,
    transport_type: transportType,
    applied_at: new Date(),
  };
  ride.fare = breakdown.fare_after_discount + Math.max(0, Number(surgeAmount || 0));

  await ride.save({ session });

  return { promo: promoUpdated.toObject(), breakdown };
};

export const listAvailablePromosForUser = async ({
  userId,
  service_location_id,
  transport_type = '',
  now = new Date(),
  limit = 50,
}) => {
  // With no service location (the promo list in the rider's profile) every
  // location's live codes are listed; booking still checks the location.
  const serviceLocationId = service_location_id ? toObjectIdOrThrow(service_location_id, 'service location id') : null;
  const transportType = normalizeTransportType(transport_type);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));

  const query = {
    active: true,
    from_date: { $lte: now },
    to_date: { $gte: now },
    ...(transport_type ? { transport_type: { $in: ['all', transportType] } } : {}),
    $and: serviceLocationId
      ? [{ $or: [{ service_location_id: serviceLocationId }, { service_location_ids: serviceLocationId }] }]
      : [],
  };

  if (userId) {
    query.$and.push({
      $or: [
        { audience_type: 'all' },
        { audience_type: { $exists: false }, user_specific: { $ne: true } },
        { audience_type: 'specific_user', user_id: String(userId) },
        { audience_type: { $exists: false }, user_specific: true, user_id: String(userId) },
        { audience_type: 'new_users' },
      ],
    });
  } else {
    query.$and.push({
      $or: [
        { audience_type: 'all' },
        { audience_type: { $exists: false }, user_specific: { $ne: true } },
      ],
    });
  }

  const promos = await PromoCode.find(query).sort({ createdAt: -1 }).limit(safeLimit).lean();
  const userObjectId = userId && mongoose.isValidObjectId(userId) ? toObjectIdOrThrow(userId, 'user id') : null;
  const hasCompletedRide = userObjectId ? Boolean(await Ride.exists({ userId: userObjectId, status: 'completed' })) : false;

  return promos
    .filter((promo) => {
      const audienceType = getPromoAudienceType(promo);
      if (audienceType === 'new_users') {
        return userObjectId ? !hasCompletedRide : false;
      }
      if (audienceType === 'specific_user') {
        return userId ? String(promo.user_id || '') === String(userId) : false;
      }
      return true;
    })
    .map((promo) => ({
      _id: promo._id,
      code: promo.code,
      transport_type: promo.transport_type,
      service_location_id: promo.service_location_id,
      service_location_ids: getPromoServiceLocationIds(promo),
      user_specific: getPromoAudienceType(promo) === 'specific_user',
      audience_type: getPromoAudienceType(promo),
      minimum_trip_amount: Number(promo.minimum_trip_amount || 0),
      maximum_discount_amount: Number(promo.maximum_discount_amount || 0),
      cumulative_max_discount_amount: Number(promo.cumulative_max_discount_amount || 0),
      discount_percentage: Number(promo.discount_percentage || 0),
      uses_per_user: Number(promo.uses_per_user || 1),
      max_uses_total: Number(promo.max_uses_total || 0),
      from_date: promo.from_date,
      to_date: promo.to_date,
    }))
    .concat(await platformPromosFor(userObjectId, hasCompletedRide));
};

/**
 * Platform coupons made in Master for Rides, in the Rides promo shape. They
 * may be a flat amount, which Rides promos never are: `discount_type` and
 * `flat_discount_amount` say so, and `maximum_discount_amount` carries the flat
 * amount too so a screen that reads only the percentage fields still shows
 * "up to Rs X" rather than nothing.
 */
const platformPromosFor = async (userObjectId, hasCompletedRide) => {
  const coupons = await listPlatformCouponsFor('taxi', { platformUserId: userObjectId });
  return coupons
    .filter((c) => c.audience !== 'first_order' || (userObjectId && !hasCompletedRide))
    .map((c) => {
      const pct = c.discountType === 'percentage';
      return {
        _id: c._id,
        code: c.code,
        platform: true,
        discount_type: pct ? 'percentage' : 'flat',
        flat_discount_amount: pct ? 0 : Number(c.discountValue) || 0,
        transport_type: 'all',
        service_location_id: null,
        service_location_ids: [],
        user_specific: false,
        audience_type: c.audience === 'first_order' ? 'new_users' : 'all',
        minimum_trip_amount: Number(c.minOrderValue || 0),
        maximum_discount_amount: pct ? Number(c.maxDiscount || 0) : Number(c.discountValue) || 0,
        cumulative_max_discount_amount: 0,
        discount_percentage: pct ? Number(c.discountValue) || 0 : 0,
        uses_per_user: Number(c.perUserLimit || 0),
        max_uses_total: Number(c.usageLimit || 0),
        from_date: c.startDate,
        to_date: c.endDate,
      };
    });
};

