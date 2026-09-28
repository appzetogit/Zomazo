/**
 * When a customer may book a visit: the hours slots run, how long each is, how
 * much notice a professional needs, and how far ahead the calendar goes.
 *
 * Kept in Settings (admin > settings) and served on /public/config as
 * `bookingSlots`, so the customer app draws the same slots the server accepts.
 * Before this the slots were hard-coded in the app and the server took any date
 * and time it was sent -- a booking for last week, or for 3 AM, went through.
 *
 * Times are wall-clock in the business timezone (a fixed UTC offset, IST by
 * default): a slot "10:00-12:00" means 10 AM where the work happens, whatever
 * timezone the customer's phone is in.
 */

const DEFAULTS = Object.freeze({
  startHour: 8, // first slot starts at 8 AM
  endHour: 20, // last slot ends by 8 PM
  slotHours: 2, // two-hour windows
  leadMinutes: 60, // a slot today needs an hour's notice
  advanceDays: 7, // today and the next six days
  timezoneOffsetMinutes: 330 // IST
});

// A request can take a moment between the app drawing a slot and the server
// reading it; do not refuse a slot that was open when the customer tapped it.
const GRACE_MINUTES = 10;

const int = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** The rules from a Settings document (or nothing), with every value in range. */
function slotRules(settings) {
  const s = settings || {};
  const startHour = int(s.slotStartHour, 0, 23, DEFAULTS.startHour);
  let endHour = int(s.slotEndHour, 1, 24, DEFAULTS.endHour);
  if (endHour <= startHour) endHour = Math.min(24, startHour + 1);
  const slotHours = Math.min(int(s.slotLengthHours, 1, 12, DEFAULTS.slotHours), endHour - startHour);
  return {
    startHour,
    endHour,
    slotHours,
    leadMinutes: int(s.slotLeadMinutes, 0, 24 * 60, DEFAULTS.leadMinutes),
    advanceDays: int(s.bookingWindowDays, 1, 60, DEFAULTS.advanceDays),
    timezoneOffsetMinutes: int(s.timezoneOffsetMinutes, -12 * 60, 14 * 60, DEFAULTS.timezoneOffsetMinutes)
  };
}

/** "10:00", "9:30", "10:00 AM" -> minutes after midnight, or null. */
function parseClock(value) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(String(value ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].toUpperCase() === 'PM';
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 24 || (h === 24 && min > 0)) {
    return null;
  }
  return h * 60 + min;
}

const DAY_MS = 86400000;

/** Midnight (as a UTC timestamp of the business-timezone calendar day) of an instant. */
const businessDay = (instant, offset) => {
  const shifted = new Date(instant + offset * 60000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
};

/**
 * Why this date and slot cannot be booked, or null when it can.
 *
 * @param {object} args
 * @param {string|Date} args.scheduledDate any instant on the day (the app sends noon)
 * @param {{start: string, end?: string}} args.timeSlot wall-clock times
 * @param {object} args.rules from slotRules()
 * @param {boolean} [args.instant] an as-soon-as-possible booking: only the day is checked
 * @param {number} [args.now] for tests
 */
function slotProblem({ scheduledDate, timeSlot, rules, instant = false, now = Date.now() }) {
  const r = rules || slotRules();
  const when = new Date(scheduledDate);
  if (Number.isNaN(when.getTime())) return 'Choose a valid date';

  if (instant) {
    const offset = r.timezoneOffsetMinutes;
    const daysAhead = Math.round((businessDay(when.getTime(), offset) - businessDay(now, offset)) / DAY_MS);
    if (daysAhead < 0) return 'That time has already passed. Choose a later slot';
    if (daysAhead >= r.advanceDays) return `Visits can be booked up to ${r.advanceDays} days ahead`;
    return null;
  }

  const start = parseClock(timeSlot?.start);
  const end = timeSlot?.end != null && String(timeSlot.end).trim() !== '' ? parseClock(timeSlot.end) : null;
  if (start == null) return 'Choose a valid time slot';
  if (timeSlot?.end != null && String(timeSlot.end).trim() !== '' && (end == null || end <= start)) {
    return 'Choose a valid time slot';
  }

  const label = (h) => `${((h + 11) % 12) + 1} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  if (start < r.startHour * 60 || (end ?? start) > r.endHour * 60) {
    return `Visits can be booked between ${label(r.startHour)} and ${label(r.endHour)}`;
  }

  const offset = r.timezoneOffsetMinutes;
  const day = businessDay(when.getTime(), offset);
  const today = businessDay(now, offset);
  const daysAhead = Math.round((day - today) / DAY_MS);
  if (daysAhead >= r.advanceDays) {
    return `Visits can be booked up to ${r.advanceDays} days ahead`;
  }

  // The slot's start as a real instant: that calendar day, that wall-clock time.
  const startsAt = day + start * 60000 - offset * 60000;
  if (daysAhead < 0 || startsAt < now) return 'That time has already passed. Choose a later slot';
  if (startsAt < now + (r.leadMinutes - GRACE_MINUTES) * 60000) {
    return r.leadMinutes >= 60
      ? `A visit needs at least ${Math.round(r.leadMinutes / 60)} hour${r.leadMinutes >= 120 ? 's' : ''} notice. Choose a later slot`
      : `A visit needs at least ${r.leadMinutes} minutes notice. Choose a later slot`;
  }
  return null;
}

/** The rules as they are now (Settings read once per call). */
async function currentSlotRules() {
  const Settings = require('../models/Settings');
  const s = await Settings.findOne({ type: 'global' })
    .select('slotStartHour slotEndHour slotLengthHours slotLeadMinutes bookingWindowDays timezoneOffsetMinutes')
    .lean();
  return slotRules(s);
}

module.exports = { DEFAULTS, slotRules, parseClock, slotProblem, currentSlotRules };
