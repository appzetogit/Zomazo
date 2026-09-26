const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const normalizeDay = (value) => {
  if (!value || typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  const match = DAY_NAMES.find((day) => day.toLowerCase() === trimmed)
  if (match) return match
  const abbreviatedMatch = DAY_NAMES.find((day) =>
    day.toLowerCase().startsWith(trimmed.slice(0, 3)),
  )
  return abbreviatedMatch || null
}

const parseTimeToMinutes = (timeValue) => {
  if (!timeValue || typeof timeValue !== "string") return null
  const raw = timeValue.trim()
  if (!raw) return null

  const normalized = raw.toLowerCase()
  const meridiemMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/)
  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1])
    const minute = Number(meridiemMatch[2])
    const period = meridiemMatch[3]
    if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null
    if (period === "pm" && hour < 12) hour += 12
    if (period === "am" && hour === 12) hour = 0
    if (hour < 0 || hour > 23) return null
    return hour * 60 + minute
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/)
  if (!twentyFourHourMatch) return null

  const hour = Number(twentyFourHourMatch[1])
  const minute = Number(twentyFourHourMatch[2])
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return hour * 60 + minute
}

const getTimingForSource = (source, dayName) => {
  if (!source || typeof source !== "object") return null
  if (Array.isArray(source?.timings)) {
    const exact = source.timings.find((entry) => normalizeDay(entry?.day) === dayName)
    if (exact) return exact
  }
  if (!Array.isArray(source)) {
    const direct = source[dayName]
    if (direct && typeof direct === "object") return direct
  }
  return null
}

const getTodayTiming = (seller, dayName) => getTimingForSource(seller?.outletTimings, dayName)

const isWithinTimeWindow = (nowMinutes, openingMinutes, closingMinutes) => {
  if (openingMinutes === null || closingMinutes === null) return true
  if (openingMinutes === closingMinutes) return true
  if (closingMinutes > openingMinutes) {
    return nowMinutes >= openingMinutes && nowMinutes <= closingMinutes
  }
  return nowMinutes >= openingMinutes || nowMinutes <= closingMinutes
}

const checkDayWindow = (seller, targetDate, nowMinutes) => {
  const dayName = DAY_NAMES[targetDate.getDay()]
  const timing = getTodayTiming(seller, dayName)
  const openDays = Array.isArray(seller?.openDays) ? seller.openDays : []

  if (timing && timing.isOpen === false) {
    return { isWithin: false, isDayClosed: true, hasWindow: true, dayName, timing }
  }

  const openingTime =
    timing?.openingTime || seller?.deliveryTimings?.openingTime || seller?.openingTime || null
  const closingTime =
    timing?.closingTime || seller?.deliveryTimings?.closingTime || seller?.closingTime || null
  const openingMinutes = parseTimeToMinutes(openingTime)
  const closingMinutes = parseTimeToMinutes(closingTime)
  const hasExplicitWindow = Boolean(openingTime || closingTime)

  if (!timing && openDays.length > 0) {
    const normalizedOpenDays = new Set(openDays.map((d) => normalizeDay(d)).filter(Boolean))
    if (normalizedOpenDays.size > 0 && !normalizedOpenDays.has(dayName)) {
      return { isWithin: false, isDayClosed: true, hasWindow: true, dayName, reason: "closed-day" }
    }
  }

  const isWithin = hasExplicitWindow
    ? openingMinutes !== null &&
      closingMinutes !== null &&
      isWithinTimeWindow(nowMinutes, openingMinutes, closingMinutes)
    : true

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
  }
}

export function getOutletScheduleStatus(seller, now = new Date()) {
  if (!seller) {
    return {
      isOpen: true,
      isDayClosed: false,
      isWithinTimings: true,
      hasConfiguredHours: false,
      reason: "no-seller",
    }
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const today = checkDayWindow(seller, now, nowMinutes)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = checkDayWindow(seller, yesterdayDate, nowMinutes)

  const yesterdayCrossesMidnight =
    yesterday.openingMinutes !== null &&
    yesterday.closingMinutes !== null &&
    yesterday.closingMinutes < yesterday.openingMinutes
  const isYesterdayStillOpen = yesterdayCrossesMidnight && nowMinutes <= yesterday.closingMinutes
  const isTodayOpen = today.isWithin
  const scheduleOpen = isTodayOpen || isYesterdayStillOpen
  const activeWindow = isTodayOpen ? today : isYesterdayStillOpen ? yesterday : today

  return {
    isOpen: scheduleOpen,
    isDayClosed: today.isDayClosed && !isYesterdayStillOpen,
    isWithinTimings: scheduleOpen,
    hasConfiguredHours: Boolean(activeWindow?.hasWindow),
    openingTime: activeWindow?.openingTime || null,
    closingTime: activeWindow?.closingTime || null,
    dayName: activeWindow?.dayName || DAY_NAMES[now.getDay()],
    reason: scheduleOpen
      ? "within-hours"
      : today.isDayClosed
        ? "closed-day"
        : activeWindow?.hasWindow
          ? "outside-hours"
          : "no-timings",
  }
}

export function getSellerOperationalStatus(seller, now = new Date()) {
  const schedule = getOutletScheduleStatus(seller, now)
  // Manual toggle OFF always wins. Toggle ON resumes outlet-timing control only.
  const isAcceptingOrders = seller?.isAcceptingOrders !== false
  const outsideHoursOverride = false
  const isEffectivelyOnline = isAcceptingOrders && schedule.isOpen

  return {
    ...schedule,
    isAcceptingOrders,
    outsideHoursOverride,
    isEffectivelyOnline,
    reason: !isAcceptingOrders
      ? "not-accepting-orders"
      : schedule.isOpen
        ? "open"
        : schedule.reason,
  }
}

export function shouldAutoTurnOffAcceptingOrders(seller, now = new Date()) {
  void seller
  void now
  return false
}

export const SELLER_ONLINE_STATUS_KEY = "seller_online_status"

export function broadcastSellerOperationalStatus(operational) {
  const isOnline = Boolean(operational?.isEffectivelyOnline)
  try {
    localStorage.setItem(SELLER_ONLINE_STATUS_KEY, JSON.stringify(isOnline))
  } catch (_) {}
  window.dispatchEvent(
    new CustomEvent("sellerStatusChanged", {
      detail: {
        isOnline,
        isEffectivelyOnline: isOnline,
        isAcceptingOrders: operational?.isAcceptingOrders === true,
        outsideHoursOverride: operational?.outsideHoursOverride === true,
        scheduleOpen: operational?.isOpen === true,
        reason: operational?.reason || "",
      },
    }),
  )
}
