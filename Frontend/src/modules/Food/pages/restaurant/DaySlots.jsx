import { useState, useRef, useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import Lenis from "lenis"
import { ArrowLeft, Clock, Edit2 } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Checkbox } from "@food/components/ui/checkbox"
import { Switch } from "@food/components/ui/switch"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

/*
 * One day's trading hours on a page of its own, with "copy to all days".
 *
 * This page used to offer up to three slots a day and saved them to a
 * localStorage key that was never even defined, so every save failed and
 * nothing ever reached the server. The server stores exactly one opening and
 * one closing time per day (outlet_timings, read by the open/closed check the
 * customer app and order placement use), so that is what this edits now,
 * through the same GET/PUT /outlet-timings the weekly page uses. Offering
 * split shifts here would promise hours the platform cannot enforce.
 */
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

const to12h = (hhmm, fallback) => {
  const m = String(hhmm || fallback).match(/^(\d{1,2}):(\d{2})$/) || String(fallback).match(/^(\d{1,2}):(\d{2})$/)
  const h24 = Math.max(0, Math.min(23, Number(m[1])))
  return {
    time: `${String(h24 % 12 || 12).padStart(2, "0")}:${m[2]}`,
    period: h24 >= 12 ? "pm" : "am",
  }
}

const to24h = (time12, period) => {
  const [h, m] = String(time12).split(":").map((x) => parseInt(x, 10) || 0)
  let hour = h % 12
  if (period === "pm") hour += 12
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

// Time Picker Wheel Component
function TimePickerWheel({ 
  isOpen, 
  onClose, 
  initialHour, 
  initialMinute, 
  initialPeriod,
  onConfirm 
}) {
  const parsedHour = Math.max(1, Math.min(12, parseInt(initialHour) || 1))
  // Ensure minute is a valid number between 0-59
  const parsedMinute = Math.max(0, Math.min(59, parseInt(initialMinute) || 0))
  const parsedPeriod = (initialPeriod === "am" || initialPeriod === "pm") ? initialPeriod : "am"
  
  const [selectedHour, setSelectedHour] = useState(parsedHour)
  const [selectedMinute, setSelectedMinute] = useState(parsedMinute)
  const [selectedPeriod, setSelectedPeriod] = useState(parsedPeriod)
  
  const hourRef = useRef(null)
  const minuteRef = useRef(null)
  const periodRef = useRef(null)

  const hours = Array.from({ length: 12 }, (_, i) => i + 1)
  const minutes = Array.from({ length: 60 }, (_, i) => i)
  const periods = ["am", "pm"]

  // Update state when initial values change
  useEffect(() => {
    if (isOpen) {
      setSelectedHour(parsedHour)
      setSelectedMinute(parsedMinute)
      setSelectedPeriod(parsedPeriod)
    }
  }, [isOpen, initialHour, initialMinute, initialPeriod, parsedHour, parsedMinute, parsedPeriod])

  // Scroll to selected value on mount and prevent body scroll
  useEffect(() => {
    if (isOpen) {
      // Prevent body scroll
      document.body.style.overflow = 'hidden'

      // Update state first
      setSelectedHour(parsedHour)
      setSelectedMinute(parsedMinute)
      setSelectedPeriod(parsedPeriod)

      // Wait for DOM to render, then scroll to position
      const timer = setTimeout(() => {
        const padding = 80 // h-20 top padding
        const itemHeight = 40

        // Scroll hour and update state - set immediately first
        const hourIndex = parsedHour - 1
        if (hourRef.current) {
          const hourScrollPos = padding + (hourIndex * itemHeight)
          hourRef.current.scrollTop = hourScrollPos
          setSelectedHour(parsedHour)
          // Then smooth scroll
          setTimeout(() => {
            hourRef.current?.scrollTo({
              top: hourScrollPos,
              behavior: 'smooth'
            })
          }, 50)
        }

        // Scroll minute and update state - set immediately first
        const minuteIndex = parsedMinute
        if (minuteRef.current) {
          const minuteScrollPos = padding + (minuteIndex * itemHeight)
          minuteRef.current.scrollTop = minuteScrollPos
          setSelectedMinute(parsedMinute)
          // Then smooth scroll
          setTimeout(() => {
            minuteRef.current?.scrollTo({
              top: minuteScrollPos,
              behavior: 'smooth'
            })
          }, 50)
        }

        // Scroll period and update state - set immediately first
        const periodIndex = periods.indexOf(parsedPeriod)
        if (periodRef.current) {
          const periodScrollPos = padding + (periodIndex * itemHeight)
          periodRef.current.scrollTop = periodScrollPos
          setSelectedPeriod(parsedPeriod)
          // Then smooth scroll
          setTimeout(() => {
            periodRef.current?.scrollTo({
              top: periodScrollPos,
              behavior: 'smooth'
            })
          }, 50)
        }
      }, 150)
      
      return () => {
        clearTimeout(timer)
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen, parsedHour, parsedMinute, parsedPeriod])

  const scrollToValue = (container, index, itemHeight, updateState = null, values = null, immediate = false) => {
    if (!container) return
    const scrollPosition = index * itemHeight
    const clampedIndex = Math.max(0, Math.min(index, values ? values.length - 1 : index))
    
    // First set position immediately to ensure it's correct
    container.scrollTop = clampedIndex * itemHeight
    
    // Update state immediately
    if (updateState && values && values[clampedIndex] !== undefined) {
      updateState(values[clampedIndex])
    }
    
    // Then do smooth scroll if not immediate
    if (!immediate) {
      setTimeout(() => {
        container.scrollTo({
          top: clampedIndex * itemHeight,
          behavior: 'smooth'
        })
      }, 50)
    }
  }

  const handleScroll = (container, setValue, values, itemHeight) => {
    if (!container) return

    const padding = 80 // top spacer (h-20)
    const itemCenterOffset = itemHeight / 2
    const scrollTop = container.scrollTop
    const containerCenter = scrollTop + container.clientHeight / 2

    // Index of item whose center is closest to the visual center line
    const index = Math.round(
      (containerCenter - padding - itemCenterOffset) / itemHeight
    )

    const clampedIndex = Math.max(0, Math.min(index, values.length - 1))
    const newValue = values[clampedIndex]

    if (newValue !== undefined) {
      setValue(newValue)
    }
  }

  const snapToCenter = (container, setValue, values, itemHeight) => {
    if (!container) return

    const padding = 80
    const itemCenterOffset = itemHeight / 2
    const scrollTop = container.scrollTop
    const containerCenter = scrollTop + container.clientHeight / 2

    const index = Math.round(
      (containerCenter - padding - itemCenterOffset) / itemHeight
    )
    const clampedIndex = Math.max(0, Math.min(index, values.length - 1))

    const snapPosition = padding + clampedIndex * itemHeight
    container.scrollTo({
      top: snapPosition,
      behavior: "smooth",
    })

    if (values[clampedIndex] !== undefined) {
      setValue(values[clampedIndex])
    }
  }

  const handleConfirm = () => {
    const hourStr = selectedHour.toString()
    const minuteStr = selectedMinute.toString().padStart(2, '0')
    onConfirm(hourStr, minuteStr, selectedPeriod)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-white rounded-lg shadow-2xl w-full max-w-xs overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Time Picker Content */}
          <div className="flex items-center justify-center py-8 px-4 relative">
            <style>{`
              .time-picker-scroll::-webkit-scrollbar {
                display: none;
              }
              .time-picker-scroll {
                -ms-overflow-style: none;
                scrollbar-width: none;
              }
            `}</style>
            
            {/* Hour Column */}
            <div className="flex-1 flex flex-col items-center">
              <div 
                ref={hourRef}
                className="w-full h-48 overflow-y-scroll time-picker-scroll snap-y snap-mandatory"
                style={{
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch'
                }}
                onScroll={() => handleScroll(hourRef.current, setSelectedHour, hours, 40)}
                onTouchEnd={() => snapToCenter(hourRef.current, setSelectedHour, hours, 40)}
              >
                <div className="h-20"></div>
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className="h-10 flex items-center justify-center snap-center"
                    style={{ minHeight: '40px' }}
                  >
                    <span
                      className={`text-lg transition-all duration-200 ${
                        selectedHour === hour
                          ? "font-bold text-gray-900 text-xl"
                          : "font-normal text-gray-400 text-base"
                      }`}
                    >
                      {hour}
                    </span>
                  </div>
                ))}
                <div className="h-20"></div>
              </div>
            </div>

            {/* Colon Separator */}
            <div className="px-2">
              <span className="text-2xl font-bold text-gray-900">:</span>
            </div>

            {/* Minute Column */}
            <div className="flex-1 flex flex-col items-center">
              <div 
                ref={minuteRef}
                className="w-full h-48 overflow-y-scroll time-picker-scroll snap-y snap-mandatory"
                style={{
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch'
                }}
                onScroll={() => handleScroll(minuteRef.current, setSelectedMinute, minutes, 40)}
                onTouchEnd={() => snapToCenter(minuteRef.current, setSelectedMinute, minutes, 40)}
              >
                <div className="h-20"></div>
                {minutes.map((minute, index) => (
                  <div
                    key={minute}
                    className="h-10 flex items-center justify-center snap-center"
                    style={{ minHeight: '40px' }}
                  >
                    <span
                      className={`text-lg transition-all duration-200 ${
                        selectedMinute === minute
                          ? "font-bold text-gray-900 text-xl"
                          : "font-normal text-gray-400 text-base"
                      }`}
                    >
                      {minute.toString().padStart(2, "0")}
                    </span>
                  </div>
                ))}
                <div className="h-20"></div>
              </div>
            </div>

            {/* Period Column */}
            <div className="flex-1 flex flex-col items-center">
              <div 
                ref={periodRef}
                className="w-full h-48 overflow-y-scroll time-picker-scroll snap-y snap-mandatory"
                style={{
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch'
                }}
                onScroll={() => handleScroll(periodRef.current, setSelectedPeriod, periods, 40)}
                onTouchEnd={() => snapToCenter(periodRef.current, setSelectedPeriod, periods, 40)}
              >
                <div className="h-20"></div>
                {periods.map((period, index) => (
                  <div
                    key={period}
                    className="h-10 flex items-center justify-center snap-center"
                    style={{ minHeight: '40px' }}
                  >
                    <span
                      className={`text-lg transition-all duration-200 ${
                        selectedPeriod === period
                          ? "font-bold text-gray-900 text-xl"
                          : "font-normal text-gray-400 text-base"
                      }`}
                    >
                      {period.toUpperCase()}
                    </span>
                  </div>
                ))}
                <div className="h-20"></div>
              </div>
            </div>

            {/* Selection Indicator Lines */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none">
              <div className="border-t border-gray-300 mx-4"></div>
              <div className="border-b border-gray-300 mx-4 mt-10"></div>
            </div>
          </div>

          {/* Okay Button */}
          <div className="border-t border-gray-200 px-4 py-4 flex justify-center">
            <button
              onClick={handleConfirm}
              className="text-blue-600 hover:text-blue-700 font-medium text-base transition-colors"
            >
              Okay
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function DaySlots() {
  const navigate = useNavigate()
  const { day } = useParams()
  const dayName = DAY_NAMES.find((d) => d.toLowerCase() === String(day || "").toLowerCase()) || "Monday"
  const backToWeek = () => navigate("/food/restaurant/outlet-timings")

  // The whole week as the server returned it; only this day is edited, but the
  // PUT replaces all seven, so the others must go back unchanged.
  const [week, setWeek] = useState(null)
  const [isOpen, setIsOpen] = useState(true)
  const [slot, setSlot] = useState({ start: "09:00", startPeriod: "am", end: "10:00", endPeriod: "pm" })
  const [copyToAllDays, setCopyToAllDays] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [timePickerOpen, setTimePickerOpen] = useState(null) // "start" | "end" | null

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await restaurantAPI.getOutletTimings()
        const timings = res?.data?.data?.outletTimings || res?.data?.outletTimings || {}
        if (!mounted) return
        const today = timings[dayName] || { isOpen: true, openingTime: "09:00", closingTime: "22:00" }
        const start = to12h(today.openingTime, "09:00")
        const end = to12h(today.closingTime, "22:00")
        setWeek(timings)
        setIsOpen(today.isOpen !== false)
        setSlot({ start: start.time, startPeriod: start.period, end: end.time, endPeriod: end.period })
      } catch (error) {
        if (mounted) toast.error(error?.response?.data?.message || "Could not load your outlet timings.")
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [dayName])

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })
    let frame
    function raf(time) {
      lenis.raf(time)
      frame = requestAnimationFrame(raf)
    }
    frame = requestAnimationFrame(raf)
    return () => {
      cancelAnimationFrame(frame)
      lenis.destroy()
    }
  }, [])

  const openingTime = to24h(slot.start, slot.startPeriod)
  const closingTime = to24h(slot.end, slot.endPeriod)

  const duration = (() => {
    const toMin = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number)
      return h * 60 + m
    }
    let diff = toMin(closingTime) - toMin(openingTime)
    // Same rule as the server: a closing time before the opening time runs
    // past midnight, and equal times mean open all day.
    if (diff <= 0) diff += 24 * 60
    const hours = Math.floor(diff / 60)
    const minutes = diff % 60
    return minutes === 0 ? `${hours} hrs` : `${hours} hrs ${minutes} mins`
  })()

  const handleSave = async () => {
    if (!week || saving) return
    const row = isOpen
      ? { isOpen: true, openingTime, closingTime }
      : { isOpen: false, openingTime: "", closingTime: "" }
    const next = { ...week }
    for (const d of copyToAllDays ? DAY_NAMES : [dayName]) next[d] = { ...row }
    setSaving(true)
    try {
      await restaurantAPI.saveOutletTimings(next)
      window.dispatchEvent(new Event("outletTimingsUpdated"))
      toast.success(copyToAllDays ? "Timings copied to every day" : `${dayName} timings saved`)
      backToWeek()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save timings. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-600">Loading outlet timings...</div>
      </div>
    )
  }

  const timeRow = (label, field) => (
    <div className="flex w-full justify-between items-center gap-3">
      <div className="flex items-center gap-2 shrink-0">
        <Clock className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{label}</span>
      </div>
      <button
        type="button"
        onClick={() => setTimePickerOpen(field)}
        className="flex items-center gap-2 border border-gray-300 rounded-sm bg-gray-50 px-3 py-2 hover:bg-gray-100"
        aria-label={`Change ${label.toLowerCase()}`}
      >
        <span className="font-bold text-gray-900" style={{ fontSize: "15px" }}>
          {slot[field]} {slot[`${field}Period`].toUpperCase()}
        </span>
        <Edit2 className="w-4 h-4 text-gray-500 shrink-0" />
      </button>
    </div>
  )

  const pickerParts = timePickerOpen ? slot[timePickerOpen].split(":") : null

  return (
    <div className="min-h-screen bg-neutral-50/60 overflow-x-hidden flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={backToWeek}
              className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">{dayName} timings</h1>
              <p className="text-xs text-gray-500 hidden sm:block">When customers can order from you on {dayName}</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="hidden sm:inline-flex items-center justify-center bg-gray-900 hover:bg-black disabled:opacity-60 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full flex-1 px-4 sm:px-6 py-6 space-y-5">
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm flex items-center justify-between">
          <span className="text-base font-bold text-gray-900">Open on {dayName}</span>
          <Switch
            checked={isOpen}
            onCheckedChange={setIsOpen}
            className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-gray-300"
          />
        </div>

        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm space-y-4"
          >
            <div>
              <span className="text-base font-bold text-gray-900">Trading hours</span>
              <span className="text-sm text-gray-600 ml-2">({duration})</span>
            </div>
            {timeRow("Opening time", "start")}
            {timeRow("Closing time", "end")}
            <p className="text-xs text-gray-500">
              A closing time earlier than the opening time runs past midnight into the next day.
            </p>
          </motion.div>
        ) : (
          <p className="text-sm text-gray-500 px-1">You will not take orders on {dayName}.</p>
        )}
      </div>

      {/* Sticky Bottom Controls */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-4 z-40 shadow-lg">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="copy-to-all"
              checked={copyToAllDays}
              onCheckedChange={(v) => setCopyToAllDays(v === true)}
              className="w-5 h-5 border-2 border-gray-300 rounded data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
            />
            <label htmlFor="copy-to-all" className="text-sm text-gray-700 cursor-pointer">
              Copy these timings to all days
            </label>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-gray-800 hover:bg-gray-900 text-white font-medium py-3 rounded-lg"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {timePickerOpen && (
        <TimePickerWheel
          isOpen={true}
          onClose={() => setTimePickerOpen(null)}
          initialHour={pickerParts[0]}
          initialMinute={pickerParts[1]}
          initialPeriod={slot[`${timePickerOpen}Period`]}
          onConfirm={(hour, minute, period) => {
            const field = timePickerOpen
            setSlot((prev) => ({
              ...prev,
              [field]: `${String(hour).padStart(2, "0")}:${minute}`,
              [`${field}Period`]: period,
            }))
            setTimePickerOpen(null)
          }}
        />
      )}
    </div>
  )
}
