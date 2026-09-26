import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

/**
 * The horizontal product rail from MOBILE_UI_SPEC.md.
 *
 * On a phone it is a two-row grid that flows into columns sized in `vw`, so
 * exactly two cards fit with a sliver of the next one showing — the cue that
 * invites a swipe — and it snaps as you scroll. From `lg` it becomes a single
 * row of fixed-width cards with arrow buttons, since a mouse has no swipe.
 *
 * A progress bar under the rail shows how far along the list you are.
 */
export default function Rail({ rows = 2, children, ariaLabel, auto = 0, cols }) {
  const scroller = useRef(null)
  const paused = useRef(false)
  const [progress, setProgress] = useState(0)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const sync = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setProgress(max > 0 ? el.scrollLeft / max : 0)
    setAtStart(el.scrollLeft <= 2)
    setAtEnd(max > 0 && el.scrollLeft >= max - 2)
  }, [])

  useEffect(() => {
    sync()
    const el = scroller.current
    if (!el) return undefined
    el.addEventListener("scroll", sync, { passive: true })
    window.addEventListener("resize", sync)
    return () => {
      el.removeEventListener("scroll", sync)
      window.removeEventListener("resize", sync)
    }
  }, [sync])

  // Drift along on its own, so the row reads as alive rather than parked.
  // It pauses while a pointer is over it, while it has focus, and when the tab
  // is hidden, and it is off entirely under prefers-reduced-motion.
  useEffect(() => {
    if (!auto) return undefined
    const el = scroller.current
    if (!el) return undefined
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined

    const step = () => {
      if (paused.current || document.hidden) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      // The distance between two columns, not a child's own width: the rail
      // snaps, and a step short of the next snap point is simply undone.
      const [a, b] = el.children
      const by = a && b ? b.offsetLeft - a.offsetLeft : el.clientWidth * 0.5
      if (by <= 0) return
      el.scrollTo({
        left: el.scrollLeft >= max - 4 ? 0 : Math.min(el.scrollLeft + by, max),
        behavior: "smooth",
      })
    }

    const timer = setInterval(step, auto)
    return () => clearInterval(timer)
  }, [auto])

  const hold = () => {
    paused.current = true
  }
  const release = () => {
    paused.current = false
  }

  const page = (direction) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.9), behavior: "smooth" })
  }

  const arrow =
    "hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-wh-border bg-wh-surface text-wh-text shadow-sm transition hover:bg-wh-brand-50 disabled:opacity-0 lg:flex"

  return (
    <div
      className="relative"
      onPointerEnter={hold}
      onPointerLeave={release}
      onPointerDown={hold}
      onPointerUp={release}
      onPointerCancel={release}
      onFocusCapture={hold}
      onBlurCapture={release}
      onTouchStart={hold}
      onTouchEnd={release}
      onTouchCancel={release}
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => page(-1)} disabled={atStart} aria-label="Scroll left" className={arrow}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <div
          ref={scroller}
          role="group"
          aria-label={ariaLabel}
          className={`wh-rail grid min-w-0 flex-1 grid-flow-col gap-3 overflow-x-auto pb-1 ${
            cols || "auto-cols-[46vw] sm:auto-cols-[31vw] lg:auto-cols-[200px]"
          } ${rows === 2 ? "grid-rows-2 lg:grid-rows-1" : "grid-rows-1"}`}
        >
          {children}
        </div>

        <button type="button" onClick={() => page(1)} disabled={atEnd} aria-label="Scroll right" className={arrow}>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* How far along the rail you are; decorative, the rail itself is scrollable. */}
      <div aria-hidden="true" className="mx-auto mt-3 h-[3px] w-24 overflow-hidden rounded-full bg-wh-border lg:hidden">
        <span
          className="block h-full rounded-full bg-wh-brand transition-transform duration-150"
          style={{ width: "40%", transform: `translateX(${progress * 150}%)` }}
        />
      </div>
    </div>
  )
}
