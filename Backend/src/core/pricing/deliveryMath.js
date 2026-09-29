/**
 * The pure delivery and tax maths Quick commerce and the Shop both bill with.
 *
 * Both modules carried their own copy of these functions (the Shop was ported
 * from the same code), and the copies drifted in both directions: Quick taxed
 * to the paisa and priced per-kilometre extras and the Master delivery formula,
 * while the Shop stopped paying riders for a 0 km trip when the distance was
 * unknown. A fix to one never reached the other. One copy now, with the best
 * of both; each module re-exports it from its own order-pricing service.
 *
 * Plain data in, plain numbers out -- no models, no settings lookups. Each
 * module still loads its own fee settings (loadActiveFeeSettings) and passes
 * them in.
 *
 * Food bills through its own engine (modules/food/shared/billing.js), whose
 * rules differ (GST-inclusive dishes, tips, platform-fee GST); folding it in
 * is a separate step.
 */
import { priceDelivery } from '../finance/deliveryFormula.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const DELIVERY_FEE_GST_RATE = 0.18;

export function computeDeliveryFeeGst(deliveryFee) {
  const base = Math.max(0, Number(deliveryFee) || 0);
  if (base <= 0) return 0;
  return round2(base * DELIVERY_FEE_GST_RATE);
}

/** The fee when no band matches: the flat fee if set, else the cheapest band. */
export function resolveBaseDeliveryFee(feeSettings = {}) {
  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? feeSettings.deliveryFeeRanges
    : [];
  const rangeFees = ranges
    .map((range) => Number(range?.fee))
    .filter((fee) => Number.isFinite(fee) && fee >= 0);

  const flat = Number(feeSettings.deliveryFee);
  const hasPositiveFlat = Number.isFinite(flat) && flat > 0;

  if (rangeFees.length > 0) {
    const minRangeFee = Math.min(...rangeFees);
    return hasPositiveFlat ? flat : minRangeFee;
  }

  return Number.isFinite(flat) && flat >= 0 ? flat : 0;
}

/**
 * What a band adds for distance beyond its own start.
 *
 * Band matching sends anything past the final band to the widest one, so
 * without this a 45km order is charged the last band's flat fee -- identical to
 * a trip at its edge -- and the rider is paid from that same figure. 0 leaves
 * the band flat, which is every band that does not set it.
 */
export const extraOf = (range, distanceKm) => {
  const rate = Number(range?.extraPerKm || 0);
  if (!(rate > 0)) return 0;
  const over = Math.max(0, Number(distanceKm || 0) - Number(range?.min || 0));
  return Math.round(rate * over * 100) / 100;
};

/** The value `pickValue` gives for the band covering `distanceKm`, or null. */
export function matchFeeRange(ranges, distanceKm, pickValue) {
  if (!Array.isArray(ranges) || ranges.length === 0 || !Number.isFinite(distanceKm)) {
    return null;
  }

  const sorted = [...ranges].sort((a, b) => Number(a.min) - Number(b.min));
  for (let i = 0; i < sorted.length; i += 1) {
    const range = sorted[i] || {};
    const min = Number(range.min);
    const max = Number(range.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

    const isLast = i === sorted.length - 1;
    const inRange = isLast
      ? distanceKm >= min && distanceKm <= max
      : distanceKm >= min && distanceKm < max;

    if (inRange) {
      const value = pickValue(range);
      return Number.isFinite(value) ? value : null;
    }
  }

  return null;
}

/**
 * GST across a basket whose lines can sit in different slabs.
 *
 * Products are taxed per line -- flour at 0, biscuits at 18 -- so one rate on
 * the whole basket is wrong in both directions. A line with no rate of its own
 * falls back to the order-wide rate.
 *
 * The discount reduces every line in proportion to its share of the basket,
 * UNLESS the platform funded it, in which case it reduces no line at all: the
 * seller is still paid in full, so the supply is worth the whole basket and the
 * tax is due on that. (A caller that knows only part is platform-funded passes
 * the seller-funded part as `discount` instead.)
 */
export function computeItemsTax(
  items = [],
  { subtotal = 0, discount = 0, fallbackRate = 0, discountFundedByPlatform = false } = {},
) {
  if (!(subtotal > 0)) return 0;

  const taxableShare = discountFundedByPlatform === true
    ? 1
    : Math.max(0, subtotal - discount) / subtotal;
  let tax = 0;

  for (const item of items) {
    // null and undefined mean "no slab of its own" and must reach the fallback.
    // Number(null) is 0, so testing the coerced value would silently make every
    // untagged item tax-free.
    const own = item?.gstRate;
    const hasOwnRate = own !== null && own !== undefined && Number.isFinite(Number(own));
    const rate = hasOwnRate ? Number(own) : Number(fallbackRate) || 0;
    if (!(rate > 0)) continue;

    const lineValue = (Number(item?.price) || 0) * (Number(item?.quantity) || 1);
    tax += lineValue * taxableShare * (rate / 100);
  }

  // To the paisa, like every other figure on the bill. Whole-rupee rounding
  // charged oil at 105 and 5% a GST of 5 instead of 5.25, while a return
  // refunds GST line by line in paise, so the two never agreed. Summed before
  // rounding, so a long basket gains no per-line error.
  return round2(tax);
}

/** What the customer pays for delivery, and how it was decided. */
export function resolveUserDeliveryFee(feeSettings = {}, { distanceKm = null } = {}) {
  if (feeSettings.deliveryFormula) {
    // An unmeasured trip is charged the base fee, as the band table did.
    const measured = Number.isFinite(distanceKm);
    const priced = priceDelivery(feeSettings.deliveryFormula.formula, measured ? distanceKm : 0);
    return {
      deliveryFee: priced.customerFee,
      distanceKm: measured ? Number(distanceKm.toFixed(2)) : null,
      source: 'delivery_formula',
    };
  }

  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? feeSettings.deliveryFeeRanges
    : [];

  if (ranges.length > 0 && Number.isFinite(distanceKm)) {
    const matchedFee = matchFeeRange(ranges, distanceKm, (range) => Number(range.fee) + extraOf(range, distanceKm));
    if (Number.isFinite(matchedFee)) {
      return {
        deliveryFee: matchedFee,
        distanceKm: Number(distanceKm.toFixed(2)),
        source: 'distance',
      };
    }
  }

  const fallbackFee = resolveBaseDeliveryFee(feeSettings);
  return {
    deliveryFee: fallbackFee,
    distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
    source: Number.isFinite(distanceKm) ? 'default_unmatched_range' : 'default',
  };
}

/** What the rider is paid for a trip of `distanceKm`. */
export function calculateRiderEarning(feeSettings = {}, distanceKm) {
  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? feeSettings.deliveryFeeRanges
    : [];

  // basePay and perKm are mutually exclusive (the admin UI enforces this too):
  // a flat basePay wins, otherwise pay per km of the actual trip.
  const payFor = (range, km) => {
    const basePay = Number(range?.deliveryBoyBasePay || 0);
    const perKm = Number(range?.deliveryBoyPerKm || 0);
    const extra = extraOf(range, km);

    if (basePay > 0) return basePay + extra;
    if (perKm > 0) return km * perKm + extra;
    return extra;
  };

  // An unknown distance is not a zero-kilometre trip. Number(null) is 0, so
  // coercing first paid the rider for a delivery to the store's own door
  // whenever an address had no coordinates, while the customer correctly paid
  // the base fee. It falls back to the shortest band instead (not the widest:
  // one missing coordinate should not trigger a long-distance payout); a
  // per-km band is credited one kilometre so a real delivery never pays nothing.
  // The Shop's fix, which Quick's copy never had.
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') {
    if (feeSettings.deliveryFormula) return priceDelivery(feeSettings.deliveryFormula.formula, 1).riderPay;
    if (ranges.length === 0) return 0;
    const shortest = [...ranges].sort((a, b) => Number(a?.min ?? 0) - Number(b?.min ?? 0))[0];
    const guaranteed = payFor(shortest, 1);
    return Number.isFinite(guaranteed) ? Math.round(guaranteed) : 0;
  }

  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (feeSettings.deliveryFormula) return priceDelivery(feeSettings.deliveryFormula.formula, distance).riderPay;
  if (ranges.length === 0) return 0;

  const matched = matchFeeRange(ranges, distance, (range) => payFor(range, distance));
  // A matched band is authoritative -- including an explicit 0.
  if (matched != null && Number.isFinite(matched)) return Math.round(matched);

  // No band covers this distance. The customer is still charged (the base
  // fee), so paying the rider 0 would be unpaid work on a real delivery
  // whenever the bands don't span the dispatch radius. Use the widest band.
  const widest = [...ranges].sort(
    (a, b) => Number(a?.max ?? 0) - Number(b?.max ?? 0),
  )[ranges.length - 1];
  const fallback = payFor(widest, distance);
  return Number.isFinite(fallback) ? Math.round(fallback) : 0;
}
