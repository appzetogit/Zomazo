import React, { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Sparkles, Coins, Clock, ArrowRight, LogIn, CheckCircle2 } from "lucide-react"
import confetti from "canvas-confetti"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"
import { spinAPI } from "@store/api"
import { isModuleAuthenticated } from "@store/utils/auth"

const DEFAULT_SEGMENTS = [
  { id: 1, label: "10 Coins", type: "coins", value: 10, color: "#f59e0b" },
  { id: 2, label: "25 Coins", type: "coins", value: 25, color: "#8b5cf6" },
  { id: 3, label: "Better Luck", type: "none", value: 0, color: "#64748b" },
  { id: 4, label: "50 Coins", type: "coins", value: 50, color: "#10b981" },
  { id: 5, label: "5 Coins", type: "coins", value: 5, color: "#3b82f6" },
  { id: 6, label: "100 Coins 🌟", type: "coins", value: 100, color: "#ec4899" },
]

/** Play gentle synthetic mechanical click */
function playTick() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "triangle"
    osc.frequency.setValueAtTime(550, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.025)
    gain.gain.setValueAtTime(0.05, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.025)
  } catch {
    // AudioContext blocked or not supported - silently ignore
  }
}

export default function SpinWheelModal({ isOpen, onClose, onRewardEarned }) {
  const navigate = useNavigate()
  const [segments, setSegments] = useState(DEFAULT_SEGMENTS)
  const [canSpin, setCanSpin] = useState(true)
  const [spinsRemaining, setSpinsRemaining] = useState(1)
  const [coinBalance, setCoinBalance] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [wonResult, setWonResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isGuest, setIsGuest] = useState(true)
  const wheelRef = useRef(null)

  // Check auth and spin status whenever modal opens
  useEffect(() => {
    if (!isOpen) {
      setWonResult(null)
      return
    }

    const signedIn = isModuleAuthenticated("user")
    setIsGuest(!signedIn)

    if (signedIn) {
      setLoading(true)
      spinAPI
        .getStatus()
        .then((res) => {
          const data = res?.data || res
          if (Array.isArray(data.segments) && data.segments.length > 0) {
            setSegments(data.segments)
          }
          setCanSpin(Boolean(data.canSpin))
          setSpinsRemaining(data.spinsRemaining ?? (data.canSpin ? 1 : 0))
          setCoinBalance(data.coinBalance ?? 0)
        })
        .catch((err) => {
          console.warn("Could not load spin status:", err)
        })
        .finally(() => {
          setLoading(false)
        })
    } else {
      // Guest user handling
      const todayStr = new Date().toISOString().slice(0, 10)
      const guestSpunDate = localStorage.getItem("wh_guest_spin_date")
      if (guestSpunDate === todayStr) {
        setCanSpin(false)
        setSpinsRemaining(0)
      } else {
        setCanSpin(true)
        setSpinsRemaining(1)
      }
    }
  }, [isOpen])

  const handleSpin = async () => {
    if (isSpinning || !canSpin || spinsRemaining <= 0) return

    setIsSpinning(true)
    setWonResult(null)

    // Schedule auditory ticking sounds that slow down
    const tickIntervals = [
      80, 80, 90, 100, 110, 120, 140, 170, 210, 260, 320, 400, 500, 650, 800,
    ]
    let accumulatedTime = 0
    tickIntervals.forEach((delay) => {
      accumulatedTime += delay
      setTimeout(() => {
        playTick()
      }, accumulatedTime)
    })

    const signedIn = isModuleAuthenticated("user")

    if (signedIn) {
      // Real backend spin
      try {
        const res = await spinAPI.play()
        const data = res?.data || res
        const winIndex = data.winningIndex ?? 0
        const wonSegment = data.segment || segments[winIndex] || segments[0]

        triggerWheelRotation(winIndex, wonSegment, true)
      } catch (err) {
        setIsSpinning(false)
        const msg =
          err?.response?.data?.message || err?.message || "Failed to spin wheel."
        toast.error(msg)
      }
    } else {
      // Guest demo / welcome spin
      // Weight toward giving them a real welcome gift (25 or 50 coins) to drive registration!
      const coinSegments = segments.filter((s) => s.type === "coins" && s.value > 0)
      const chosenSegment =
        coinSegments.find((s) => s.value === 50) ||
        coinSegments[Math.floor(Math.random() * coinSegments.length)] ||
        segments[0]
      const winIndex = segments.findIndex((s) => s.id === chosenSegment.id)

      // Store guest spin date in localStorage
      const todayStr = new Date().toISOString().slice(0, 10)
      localStorage.setItem("wh_guest_spin_date", todayStr)
      localStorage.setItem("wh_pending_coins", String(chosenSegment.value || 50))

      triggerWheelRotation(winIndex >= 0 ? winIndex : 0, chosenSegment, false)
    }
  }

  const triggerWheelRotation = (winIndex, wonSegment, isAuthenticatedUser) => {
    const numSegments = segments.length
    const sliceAngle = 360 / numSegments
    const midAngle = winIndex * sliceAngle + sliceAngle / 2
    const currentMod = rotation % 360
    const desiredMod = (((270 - midAngle) % 360) + 360) % 360

    let diff = desiredMod - currentMod
    if (diff <= 0) diff += 360

    const fullSpins = 360 * 6 // 6 full revolutions
    const finalRotation = rotation + fullSpins + diff

    setRotation(finalRotation)

    setTimeout(() => {
      setIsSpinning(false)
      setCanSpin(false)
      setSpinsRemaining(0)
      setWonResult(wonSegment)

      if (wonSegment.type === "coins" && wonSegment.value > 0) {
        confetti({
          particleCount: 90,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#ef4444"],
        })

        if (isAuthenticatedUser) {
          toast.success(`🎉 Congratulations! You won ${wonSegment.value} coins!`)
          setCoinBalance((prev) => prev + wonSegment.value)
          if (onRewardEarned) onRewardEarned(wonSegment.value)
        } else {
          toast.success(`🎉 You won ${wonSegment.value} coins! Sign in to claim.`)
        }
      } else {
        toast.info("Better luck next time! Check back tomorrow for another spin.")
      }
    }, 5000)
  }

  if (!isOpen) return null

  const sliceAngle = 360 / segments.length
  const radius = 135

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-md overflow-hidden rounded-3xl bg-gradient-to-b from-gray-900 via-gray-950 to-black p-6 border-2 border-amber-500/40 shadow-2xl text-white text-center"
        >
          {/* Ambient Corner Glow */}
          <div className="absolute -top-16 -left-16 w-36 h-36 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -right-16 w-36 h-36 bg-orange-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-gray-400 hover:text-white transition cursor-pointer z-30"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Title badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-2 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold tracking-wide uppercase shadow-inner">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin [animation-duration:5s]" />
            Daily Lucky Wheel
          </div>

          <h2 className="text-2xl sm:text-3xl font-black bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent">
            Spin & Win Coins
          </h2>
          <p className="text-xs text-gray-300 mt-1 mb-5">
            Win free coins to get instant discounts on apparel & grocery orders!
          </p>

          {/* Wheel Container */}
          <div className="relative w-[290px] h-[290px] mx-auto mb-6 flex items-center justify-center">
            {/* Top Pointer Indicator with dynamic ticker vibration */}
            <div
              className={`absolute top-0 left-1/2 -translate-x-1/2 z-30 -mt-2 origin-top ${
                isSpinning ? "animate-ticker" : ""
              }`}
            >
              <div
                className="w-7 h-9 bg-gradient-to-b from-yellow-300 to-amber-500 shadow-xl drop-shadow-[0_0_12px_rgba(245,158,11,0.9)] border-t border-white"
                style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }}
              />
            </div>

            {/* Glowing outer aura ring */}
            <div className="absolute inset-0 rounded-full border-4 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,0.4)] animate-pulse pointer-events-none" />

            {/* SVG Wheel */}
            <motion.div
              ref={wheelRef}
              className="w-full h-full"
              style={{ transformOrigin: "center center" }}
              animate={{ rotate: rotation }}
              transition={{ duration: 5, ease: [0.15, 0.9, 0.2, 1] }}
            >
              <svg
                width="290"
                height="290"
                viewBox="0 0 300 300"
                className="w-full h-full drop-shadow-2xl"
              >
                <g transform="translate(150, 150)">
                  {segments.map((seg, i) => {
                    const startAngle = (i * sliceAngle * Math.PI) / 180
                    const endAngle = ((i + 1) * sliceAngle * Math.PI) / 180
                    const x1 = radius * Math.cos(startAngle)
                    const y1 = radius * Math.sin(startAngle)
                    const x2 = radius * Math.cos(endAngle)
                    const y2 = radius * Math.sin(endAngle)
                    const pathData = `M 0 0 L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`

                    const midAngle = i * sliceAngle + sliceAngle / 2
                    return (
                      <g key={seg.id || i}>
                        <path
                          d={pathData}
                          fill={seg.color || "#3b82f6"}
                          stroke="#0f172a"
                          strokeWidth="2.5"
                        />
                        <g transform={`rotate(${midAngle}) translate(${radius * 0.65}, 0)`}>
                          <text
                            transform="rotate(90)"
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            fill="#ffffff"
                            fontSize="11"
                            fontWeight="800"
                            letterSpacing="0.02em"
                            style={{ filter: "drop-shadow(0px 1px 3px rgba(0,0,0,0.9))" }}
                          >
                            {seg.label}
                          </text>
                        </g>
                      </g>
                    )
                  })}
                </g>
              </svg>
            </motion.div>

            {/* Center Spin Button / Hub */}
            <div className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 border-2 border-white shadow-2xl flex items-center justify-center z-20">
              <button
                onClick={handleSpin}
                disabled={isSpinning || !canSpin}
                className="w-full h-full rounded-full flex flex-col items-center justify-center text-[11px] font-black uppercase tracking-tight text-gray-950 transition hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-inner"
              >
                {isSpinning ? "..." : "SPIN"}
              </button>
            </div>
          </div>

          {/* Winning Celebration Card */}
          {wonResult && (
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="p-4 mb-4 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-yellow-500/20 border border-amber-500/50 text-center shadow-lg"
            >
              {wonResult.type === "coins" && wonResult.value > 0 ? (
                <div>
                  <div className="text-3xl mb-1">🎁</div>
                  <div className="font-extrabold text-amber-300 text-lg">
                    You Won {wonResult.value} Coins!
                  </div>
                  <p className="text-xs text-gray-200 mt-1 mb-3">
                    {isGuest
                      ? "Sign in to save these coins to your wallet and get discounts!"
                      : "Added directly to your coin balance. Use at checkout!"}
                  </p>

                  {isGuest && (
                    <button
                      onClick={() => {
                        onClose()
                        navigate("/auth/login")
                      }}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-gray-950 font-bold text-xs shadow-lg hover:brightness-110 active:scale-95 transition cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Sign in to Claim Coins
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-2xl mb-1">☘️</div>
                  <div className="font-bold text-gray-200">Better Luck Next Time!</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Come back tomorrow for another guaranteed free spin!
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Footer Info */}
          <div className="flex items-center justify-between text-xs text-gray-300 pt-3 border-t border-white/10">
            <div className="flex items-center gap-1.5 font-medium">
              <Coins className="w-4 h-4 text-amber-400" />
              <span>
                Balance:{" "}
                <strong className="text-amber-300">
                  {isGuest ? "0 (Guest)" : `${coinBalance} Coins`}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <span className={canSpin ? "text-emerald-400 font-semibold" : "text-gray-400"}>
                {canSpin ? "1 Free Spin Ready" : "Resets Tomorrow"}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
