import { useMemo } from "react"
import { cx, focusRing, slotsFor, upcomingDays } from "../helpers"

/**
 * Date and two-hour window for a visit, over the next week.
 * `value` is { dateKey, slot } or null; onChange gets the same shape.
 */
export default function SlotPicker({ value, onChange }) {
  const days = useMemo(() => upcomingDays(7), [])
  const dateKey = value?.dateKey || days[0].key
  const slots = useMemo(() => slotsFor(dateKey), [dateKey])
  // Late in the evening today has nothing left; say so rather than show a wall of disabled slots.
  const noneToday = slots.every((s) => s.disabled)

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
      {noneToday ? (
        <p className="mt-3 text-sm text-gray-500">No more slots today. Pick another day.</p>
      ) : null}
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
