import { useEffect, useMemo, useState } from "react"
import { useServicesConfig } from "../hooks"
import { cx, focusRing, slotsFor, upcomingDays } from "../helpers"

/**
 * Date and time window for a visit, drawn from the server's slot rules (hours,
 * slot length, notice and how far ahead), so every slot offered is one the
 * booking endpoint accepts. `value` is { dateKey, slot } or null; onChange gets
 * the same shape.
 */
export default function SlotPicker({ value, onChange }) {
  const config = useServicesConfig()
  const rules = config.data?.bookingSlots
  // Re-drawn every minute, so a slot open when the screen loaded does not stay
  // offered after its notice has run out.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const days = useMemo(() => upcomingDays(rules), [rules, tick])
  // Late in the evening today has nothing left, so start on the first day that does.
  const firstOpen = useMemo(
    () => days.find((d) => slotsFor(d.key, rules).some((s) => !s.disabled))?.key || days[0].key,
    [days, rules]
  )
  const dateKey = value?.dateKey && days.some((d) => d.key === value.dateKey) ? value.dateKey : firstOpen
  const slots = useMemo(() => slotsFor(dateKey, rules), [dateKey, rules, tick])
  const noneLeft = slots.every((s) => s.disabled)

  // A picked slot that has since closed is dropped rather than sent and refused.
  useEffect(() => {
    if (value?.slot && slots.find((s) => s.id === value.slot.id)?.disabled !== false) {
      onChange({ dateKey, slot: null })
    }
  }, [slots, value, dateKey, onChange])

  return (
    <div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Day">
        {days.map((d) => {
          const active = d.key === dateKey
          return (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ dateKey: d.key, slot: null })}
              className={cx(
                "flex w-16 shrink-0 flex-col items-center rounded-xl border py-2",
                active ? "border-violet-600 bg-violet-50 text-violet-700" : "border-gray-200 bg-white text-gray-700",
                focusRing
              )}
            >
              <span className="text-[11px] font-semibold">{d.weekday}</span>
              <span className="text-lg font-extrabold leading-tight">{d.day}</span>
              <span className="text-[11px]">{d.month}</span>
            </button>
          )
        })}
      </div>
      {noneLeft ? <p className="mt-3 text-sm text-gray-500">No more slots on this day. Pick another day.</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Time">
        {slots.map((s) => {
          const active = value?.slot?.id === s.id
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={s.disabled}
              onClick={() => onChange({ dateKey, slot: s })}
              className={cx(
                "rounded-xl border px-2 py-2.5 text-xs font-bold",
                s.disabled
                  ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300"
                  : active
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:border-violet-300",
                focusRing
              )}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
