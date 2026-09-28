/**
 * Demand-triggered peak zones.
 *
 * A zone's admin form has always stored five peak-zone settings, and nothing
 * read them. They now mean:
 *
 *   peak_zone_ride_count          open ride requests that make the area "peak"
 *   peak_zone_radius              around the pickup, in the zone's unit (km or
 *                                 miles); empty = the whole zone
 *   peak_zone_selection_duration  minutes of requests counted (look-back window)
 *   peak_zone_duration            minutes the peak stays on once triggered;
 *                                 also the look-back when the window is empty
 *   peak_zone_surge_percentage    % of the fare added while it is on
 *
 * "Open" is a request still searching for a driver: unmet demand, which is the
 * thing surge exists to answer. Requests already matched do not count.
 *
 * Once triggered the zone remembers until when (peak_zone_active_until), so a
 * peak does not flicker off the moment one driver accepts.
 *
 * Only the arithmetic lives here as pure functions; peakDemandFor() is the one
 * database read, used by the quote and the booking alike so they agree.
 */
import mongoose from 'mongoose';

const EARTH_RADIUS_KM = 6378.1;
const KM_PER_MILE = 1.609344;

const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The zone's peak rule, or null when it is not configured. */
export const peakRuleOf = (zone) => {
  if (!zone) return null;
  const threshold = positive(zone.peak_zone_ride_count);
  const percent = positive(zone.peak_zone_surge_percentage);
  const windowMinutes = positive(zone.peak_zone_selection_duration) ?? positive(zone.peak_zone_duration);
  if (!threshold || !percent || !windowMinutes) return null;
  const radius = positive(zone.peak_zone_radius);
  const unit = String(zone.unit || 'km').toLowerCase();
  return {
    threshold: Math.ceil(threshold),
    percent,
    windowMinutes,
    holdMinutes: positive(zone.peak_zone_duration) ?? 0,
    radiusKm: radius ? (unit.startsWith('mi') ? radius * KM_PER_MILE : radius) : null,
  };
};

/**
 * Whether the zone is at peak, given how many open requests were counted.
 * An earlier trigger still inside its hold keeps it on.
 */
export const evaluatePeak = (rule, { openRequests = 0, activeUntil = null, at = new Date() } = {}) => {
  if (!rule) return { active: false, percent: 0, openRequests, threshold: null, activeUntil: null, triggered: false };
  const heldUntil = activeUntil ? new Date(activeUntil) : null;
  const held = Boolean(heldUntil && heldUntil.getTime() > at.getTime());
  const triggered = openRequests >= rule.threshold;
  const nextUntil = triggered && rule.holdMinutes
    ? new Date(at.getTime() + rule.holdMinutes * 60000)
    : (held ? heldUntil : null);
  const active = triggered || held;
  return {
    active,
    percent: active ? rule.percent : 0,
    openRequests,
    threshold: rule.threshold,
    activeUntil: active ? nextUntil : null,
    triggered,
  };
};

/**
 * The Mongo filter for open requests in the window: near the pickup when the
 * zone has a radius, else anywhere in the zone.
 */
export const openRequestFilter = (rule, { zoneId, pickupPoint, at = new Date() }) => {
  const since = new Date(at.getTime() - rule.windowMinutes * 60000);
  const filter = {
    status: 'searching',
    createdAt: { $gte: since, $lte: at },
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: at } }],
  };
  if (rule.radiusKm && Array.isArray(pickupPoint) && pickupPoint.length >= 2) {
    filter.pickupLocation = {
      $geoWithin: { $centerSphere: [[Number(pickupPoint[0]), Number(pickupPoint[1])], rule.radiusKm / EARTH_RADIUS_KM] },
    };
  } else {
    filter['pricingSnapshot.surge_zone_id'] = new mongoose.Types.ObjectId(String(zoneId));
  }
  return filter;
};

/**
 * Peak state for a pickup in `zone`, counting open requests and remembering a
 * trigger on the zone. Never throws: surge is a price nudge, and a failed count
 * must not stop anyone booking a ride.
 */
export const peakDemandFor = async ({ zone, pickupPoint, Ride, Zone, at = new Date() }) => {
  const rule = peakRuleOf(zone);
  if (!rule || !zone?._id) return evaluatePeak(null);
  try {
    const openRequests = await Ride.countDocuments(openRequestFilter(rule, { zoneId: zone._id, pickupPoint, at }));
    const result = evaluatePeak(rule, { openRequests, activeUntil: zone.peak_zone_active_until, at });
    if (result.triggered && rule.holdMinutes && Zone) {
      await Zone.updateOne({ _id: zone._id }, { $max: { peak_zone_active_until: result.activeUntil } }).catch(() => {});
    }
    return result;
  } catch {
    return evaluatePeak(null);
  }
};
