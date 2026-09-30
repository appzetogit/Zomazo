import { useEffect, useRef, useState } from "react"
import { ArrowLeftRight, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { discoverBusinesses, listBusinesses, openRemoteBusiness, rememberActiveSlotBusiness, switchToBusiness } from "./businesses"

const STATE_TEXT = { pending: "Waiting for approval", rejected: "Not approved", suspended: "Suspended", deactivated: "Deactivated" }

/**
 * "Switch business" for partners with more than one business: a restaurant, a
 * Quick store, a Shop store, a Services business. Lists the ones signed in
 * here, then the partner's others on the same verified number (opened without
 * another OTP -- see businesses.js). Renders nothing for a partner with one.
 *
 * `current` is the panel showing it ('food' | 'qc' | 'shop' | 'services');
 * `tone` is 'dark' on the dark sidebar and 'light' on the white top bars;
 * `align` opens the menu from the left or right edge of the button.
 */
export default function BusinessSwitcher({ current, tone = "light", align = "left", className = "" }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const [businesses, setBusinesses] = useState([])
  const [opening, setOpening] = useState("")
  const ref = useRef(null)
  const buttonRef = useRef(null)

  // Placed against the window, not the button's box: the restaurant sidebar
  // hides overflow, which cut the menu off at its edge.
  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuPos(
        align === "right"
          ? { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }
          : { top: rect.bottom + 4, left: Math.max(8, rect.left) },
      )
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    // The slot's tokens refresh in place; keep the list's copy current.
    rememberActiveSlotBusiness()
    setBusinesses(listBusinesses(current))
    let alive = true
    discoverBusinesses(current).then((all) => alive && setBusinesses(all)).catch(() => {})
    return () => {
      alive = false
    }
  }, [current])

  const choose = async (b) => {
    if (b.active || opening) return
    if (!b.remote) {
      setOpen(false)
      switchToBusiness(b.key)
      return
    }
    setOpening(b.key)
    try {
      await openRemoteBusiness(b.remote)
    } catch (err) {
      toast.error(err.message)
      setOpening("")
    }
  }

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => event.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (businesses.length < 2) return null

  const dark = tone === "dark"
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
          dark ? "text-neutral-300 hover:bg-neutral-800 hover:text-white" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        Switch business
      </button>
      {open && (
        <div
          role="menu"
          style={menuPos || undefined}
          className="fixed z-[80] w-64 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {businesses.map((b, i) => (
            <div key={b.key}>
              {b.remote && !businesses[i - 1]?.remote && (
                <p className="border-t border-gray-100 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Also on your number
                </p>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(b)}
                disabled={Boolean(opening)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{b.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {b.label}
                    {b.state && b.state !== "approved" ? ` · ${STATE_TEXT[b.state] || b.state}` : ""}
                  </p>
                </div>
                {b.active && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                {opening === b.key && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
