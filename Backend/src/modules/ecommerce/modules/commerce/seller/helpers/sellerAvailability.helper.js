import {
  getPreviousDayName,
  getSellerLocalTimeParts,
} from '../../../../utils/timezone.js';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const normalizeDay = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const match = DAY_NAMES.find((day) => day.toLowerCase() === trimmed);
  if (match) return match;
  const abbreviatedMatch = DAY_NAMES.find((day) =>
    day.toLowerCase().startsWith(trimmed.slice(0, 3)),
  );
  return abbreviatedMatch || null;
};

const parseTimeToMinutes = (timeValue) => {
  if (!timeValue || typeof timeValue !== 'string') return null;
  const raw = timeValue.trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase();
  const meridiemMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/);
  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1]);
    const minute = Number(meridiemMatch[2]);
    const period = meridiemMatch[3];
    if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null;
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) return null;
    return hour * 60 + minute;
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!twentyFourHourMatch) return null;

  const hour = Number(twentyFourHourMatch[1]);
  const minute = Number(twentyFourHourMatch[2]);
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
};

const getTimingForSource = (source, dayName) => {
  if (!source || typeof source !== 'object') return null;

  const outletTimingsArray = source?.timings;
  if (Array.isArray(outletTimingsArray)) {
    const exact = outletTimingsArray.find((entry) => normalizeDay(entry?.day) === dayName);
    if (exact) return exact;
  }

  if (!Array.isArray(source)) {
    const direct = source[dayName];
    if (direct && typeof direct === 'object') return direct;
  }

  return null;
};

const getTodayTiming = (seller, dayName) => {
  const fromOutlet = getTimingForSource(seller?.outletTimings, dayName);
  if (fromOutlet) return fromOutlet;
  return null;
};

const isWithinTimeWindow = (nowMinutes, openingMinutes, closingMinutes) => {
  if (openingMinutes === null || closingMinutes === null) return true;
  if (openingMinutes === closingMinutes) return true;

  if (closingMinutes > openingMinutes) {
    return nowMinutes >= openingMinutes && nowMinutes <= closingMinutes;
  }

  return nowMinutes >= openingMinutes || nowMinutes <= closingMinutes;
};

const checkDayWindow = (seller, dayName, nowMinutes) => {
  const timing = getTodayTiming(seller, dayName);
  const openDays = Array.isArray(seller?.openDays) ? seller.openDays : [];

  if (timing && timing.isOpen === false) {
    return {
      isWithin: false,
      isDayClosed: true,
      hasWindow: true,
      dayName,
      timing,
    };
  }

  const openingTime =
    timing?.openingTime ||
    seller?.deliveryTimings?.openingTime ||
    seller?.openingTime ||
    null;
  const closingTime =
    timing?.closingTime ||
    seller?.deliveryTimings?.closingTime ||
    seller?.closingTime ||
    null;
  const openingMinutes = parseTimeToMinutes(openingTime);
  const closingMinutes = parseTimeToMinutes(closingTime);
  const hasExplicitWindow = Boolean(openingTime || closingTime);

  if (!timing && openDays.length > 0) {
    const normalizedOpenDays = new Set(
      openDays.map((d) => normalizeDay(d)).filter(Boolean),
    );
    if (normalizedOpenDays.size > 0 && !normalizedOpenDays.has(dayName)) {
      return {
        isWithin: false,
        isDayClosed: true,
        hasWindow: true,
        dayName,
        reason: 'closed-day',
      };
    }
  }

  // With slots, the store is open only inside one of them (the gaps are
  // closed); the reported window is the current slot, or the next one today.
  const slots = Array.isArray(timing?.slots)
    ? timing.slots
        .map((s) => ({ ...s, startMin: parseTimeToMinutes(s?.start), endMin: parseTimeToMinutes(s?.end) }))
        .filter((s) => s.startMin !== null && s.endMin !== null)
    : [];
  if (slots.length) {
    const current = slots.find((s) => isWithinTimeWindow(nowMinutes, s.startMin, s.endMin));
    const shown = current || slots.find((s) => s.startMin > nowMinutes) || slots[0];
    const last = slots[slots.length - 1];
    return {
      isWithin: Boolean(current),
      isDayClosed: false,
      hasWindow: true,
      dayName,
      openingTime: shown.start,
      closingTime: shown.end,
      // For the "yesterday still open past midnight" check: the day's last slot.
      openingMinutes: last.startMin,
      closingMinutes: last.endMin,
      timing,
    };
  }

  const isWithin = hasExplicitWindow
    ? openingMinutes !== null &&
      closingMinutes !== null &&
      isWithinTimeWindow(nowMinutes, openingMinutes, closingMinutes)
    : true;

  return {
    isWithin,
    isDayClosed: false,
    hasWindow: hasExplicitWindow,
    dayName,
    openingTime,
    closingTime,
    openingMinutes,
    closingMinutes,
    timing,
  };
};

export function getOutletScheduleStatus(seller, now = new Date()) {
  if (!seller) {
    return {
      isOpen: true,
      isDayClosed: false,
      isWithinTimings: true,
      hasConfiguredHours: false,
      reason: 'no-seller',
    };
  }

  const { dayName, nowMinutes } = getSellerLocalTimeParts(now);
  const today = checkDayWindow(seller, dayName, nowMinutes);
  const yesterday = checkDayWindow(
    seller,
    getPreviousDayName(dayName),
    nowMinutes,
  );

  const yesterdayCrossesMidnight =
    yesterday.openingMinutes !== null &&
    yesterday.closingMinutes !== null &&
    yesterday.closingMinutes < yesterday.openingMinutes;
  const isYesterdayStillOpen =
    yesterdayCrossesMidnight && nowMinutes <= yesterday.closingMinutes;
  const isTodayOpen = today.isWithin;
  const scheduleOpen = isTodayOpen || isYesterdayStillOpen;
  const activeWindow = isTodayOpen ? today : isYesterdayStillOpen ? yesterday : today;

  return {
    isOpen: scheduleOpen,
    isDayClosed: today.isDayClosed && !isYesterdayStillOpen,
    isWithinTimings: scheduleOpen,
    hasConfiguredHours: Boolean(activeWindow?.hasWindow),
    openingTime: activeWindow?.openingTime || null,
    closingTime: activeWindow?.closingTime || null,
    dayName: activeWindow?.dayName || dayName,
    reason: scheduleOpen
      ? 'within-hours'
      : today.isDayClosed
        ? 'closed-day'
        : activeWindow?.hasWindow
          ? 'outside-hours'
          : 'no-timings',
  };
}

export function getSellerOperationalStatus(seller, now = new Date()) {
  const schedule = getOutletScheduleStatus(seller, now);
  // Manual toggle OFF (isAcceptingOrders=false) always wins over outlet timings.
  // Toggle ON only clears the override — availability then follows outlet timings.
  const isAcceptingOrders = seller?.isAcceptingOrders !== false;
  const outsideHoursOverride = false;
  const isEffectivelyOnline = isAcceptingOrders && schedule.isOpen;

  return {
    ...schedule,
    isAcceptingOrders,
    outsideHoursOverride,
    isEffectivelyOnline,
    reason: !isAcceptingOrders
      ? 'not-accepting-orders'
      : schedule.isOpen
        ? 'open'
        : schedule.reason,
  };
}

export function getSellerAvailabilityStatus(seller, now = new Date(), options = {}) {
  if (!seller) {
    return {
      isOpen: false,
      isActive: false,
      isAcceptingOrders: false,
      isWithinTimings: false,
      reason: 'missing-seller',
    };
  }

  const ignoreOperationalStatus = options?.ignoreOperationalStatus === true;
  const isActive = seller.isActive !== false;
  const isAcceptingOrders = seller.isAcceptingOrders !== false;

  if (!ignoreOperationalStatus && !isActive) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: 'inactive',
    };
  }

  if (!ignoreOperationalStatus && !isAcceptingOrders) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: 'not-accepting-orders',
    };
  }

  const { dayName, nowMinutes } = getSellerLocalTimeParts(now);
  const today = checkDayWindow(seller, dayName, nowMinutes);
  const yesterday = checkDayWindow(
    seller,
    getPreviousDayName(dayName),
    nowMinutes,
  );

  const yesterdayCrossesMidnight =
    yesterday.openingMinutes !== null &&
    yesterday.closingMinutes !== null &&
    yesterday.closingMinutes < yesterday.openingMinutes;
  const isYesterdayStillOpen =
    yesterdayCrossesMidnight && nowMinutes <= yesterday.closingMinutes;
  const isTodayOpen = today.isWithin;
  const isOpenNow = isTodayOpen || isYesterdayStillOpen;
  const activeWindow = isTodayOpen ? today : isYesterdayStillOpen ? yesterday : today;

  return {
    isOpen: isOpenNow,
    isActive,
    isAcceptingOrders,
    isWithinTimings: isOpenNow,
    openingTime: activeWindow?.openingTime || null,
    closingTime: activeWindow?.closingTime || null,
    reason: isOpenNow
      ? isAcceptingOrders
        ? 'open'
        : 'open-by-timings'
      : activeWindow?.hasWindow
        ? 'outside-hours'
        : 'no-timings',
  };
}

export function assertSellerAcceptingOrders(seller, at = new Date()) {
  const availability = getSellerAvailabilityStatus(seller, at);
  if (availability.isOpen) return availability;

  if (availability.reason === 'not-accepting-orders') {
    throw new Error('SELLER_OFFLINE');
  }

  throw new Error('SELLER_CLOSED');
}

export function shouldAutoTurnOffAcceptingOrders(seller, now = new Date()) {
  // Toggle ON must remain sticky so outlet timings can control availability.
  // Never auto-flip isAcceptingOrders off just because the schedule is closed.
  void seller;
  void now;
  return false;
}
