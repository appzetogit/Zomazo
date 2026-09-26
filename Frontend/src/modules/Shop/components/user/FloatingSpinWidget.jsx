import React, { useEffect, useState } from "react"
import { Sparkles, X } from "lucide-react"

/**
 * FloatingSpinWidget
 * A vibrant, animated floating button fixed to the bottom-left of the screen.
 * Features:
 * - Continuous slow wheel spin animation with faster spin on hover
 * - Pulsing halo / glowing ring
 * - Bobbing floating animation
 * - Eye-catching "Spin & Win" badge with "Free Spin" chip
 * - Opens the Spin & Win Lucky Wheel modal on click
 *
 * It floats over the page, so it shrinks to the wheel alone after a few
 * seconds (and can be dismissed for the session) — at full width it covered
 * the filter rail on category pages.
 */
const SPIN_WIDGET_DISMISSED_KEY = "store-spin-widget-dismissed-v1"

export default function FloatingSpinWidget({ onOpenSpin }) {
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SPIN_WIDGET_DISMISSED_KEY) === "1"
    } catch {
      return false
    }
  })

  useEffect(() => {
    const timer = setTimeout(() => setCollapsed(true), 6000)
    return () => clearTimeout(timer)
  }, [])

  const dismiss = (event) => {
    event.stopPropagation()
    setDismissed(true)
    try {
      sessionStorage.setItem(SPIN_WIDGET_DISMISSED_KEY, "1")
    } catch {
      /* session storage unavailable — hide for this render only */
    }
  }

  if (dismissed) return null

  return (
    <div
      className="group/spin fixed bottom-[124px] right-3 lg:bottom-8 lg:left-8 lg:right-auto z-40 select-none lg:animate-float"
      onMouseEnter={() => setCollapsed(false)}
      onFocus={() => setCollapsed(false)}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide Spin & Win"
        className={`absolute -top-1.5 -right-1.5 z-10 hidden lg:flex w-5 h-5 rounded-full bg-white text-gray-600 border border-amber-200 shadow-md flex items-center justify-center transition-opacity ${
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        <X className="w-3 h-3" />
      </button>
      <button
        onClick={onOpenSpin}
        type="button"
        aria-label="Spin & Win Daily Rewards"
        className={`group relative flex items-center gap-3 rounded-full ${
          collapsed ? "p-0.5 lg:p-1" : "p-0.5 lg:pl-2 lg:pr-4 lg:py-2"
        } bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white shadow-2xl hover:shadow-[0_10px_25px_-5px_rgba(245,158,11,0.6)] border-2 border-amber-300/80 cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95`}
      >
        {/* Pulsing Outer Glow Aura */}
        <span className="absolute -inset-1 hidden lg:block rounded-full bg-gradient-to-r from-amber-400 to-orange-500 opacity-60 blur-md group-hover:opacity-90 animate-pulse transition duration-500 -z-10" />

        {/* Rotating Wheel Graphics */}
        <div className="relative flex items-center justify-center w-9 h-9 lg:w-11 lg:h-11 rounded-full bg-gradient-to-br from-amber-300 to-yellow-500 p-0.5 shadow-md">
          {/* SVG Fortune Wheel with colorful slices */}
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full animate-spin-slow group-hover:[animation-duration:3s] transition-all"
          >
            {/* Slice 1: Amber */}
            <path d="M50 50 L50 2 A48 48 0 0 1 91.5 26 Z" fill="#f59e0b" />
            {/* Slice 2: Pink */}
            <path d="M50 50 L91.5 26 A48 48 0 0 1 91.5 74 Z" fill="#ec4899" />
            {/* Slice 3: Violet */}
            <path d="M50 50 L91.5 74 A48 48 0 0 1 50 98 Z" fill="#8b5cf6" />
            {/* Slice 4: Emerald */}
            <path d="M50 50 L50 98 A48 48 0 0 1 8.5 74 Z" fill="#10b981" />
            {/* Slice 5: Blue */}
            <path d="M50 50 L8.5 74 A48 48 0 0 1 8.5 26 Z" fill="#3b82f6" />
            {/* Slice 6: Red-Orange */}
            <path d="M50 50 L8.5 26 A48 48 0 0 1 50 2 Z" fill="#ef4444" />

            {/* Inner Ring Divider */}
            <circle cx="50" cy="50" r="48" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.6" />

            {/* Center Golden Pin */}
            <circle cx="50" cy="50" r="14" fill="#ffffff" />
            <circle cx="50" cy="50" r="11" fill="#f59e0b" />
          </svg>

          {/* Pointer indicator at top */}
          <div
            className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2.5 bg-white shadow-sm z-10"
            style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }}
          />

          {/* Sparkle icon at bottom-right */}
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-yellow-300 text-amber-900 flex items-center justify-center shadow-xs">
            <Sparkles className="w-2.5 h-2.5 animate-spin [animation-duration:4s]" />
          </div>
        </div>

        {/* Text and Badges */}
        <div className={`flex-col text-left leading-none ${collapsed ? "hidden" : "hidden lg:flex"}`}>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-black tracking-tight text-white drop-shadow-sm">
              Spin & Win
            </span>
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase bg-white text-orange-700 shadow-xs animate-bounce [animation-duration:2s]">
              Free
            </span>
          </div>
          <span className="text-[10px] font-semibold text-amber-100 flex items-center gap-1 mt-0.5">
            <span>Win Daily Coins</span>
            <span className="text-yellow-200">🪙</span>
          </span>
        </div>
      </button>
    </div>
  )
}
