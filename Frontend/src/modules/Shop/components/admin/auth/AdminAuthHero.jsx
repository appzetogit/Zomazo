import { motion, useReducedMotion } from "framer-motion"
import { Store, Zap, Truck, Coins } from "lucide-react"
import { useCompanyName } from "@store/hooks/useCompanyName"
import MarketplaceArt from "./MarketplaceArt"

/**
 * Left-hand hero on the admin auth screens.
 *
 * Says what the platform is: many sellers, one marketplace, delivered either
 * in minutes by a rider or shipped by courier. What it can do, not made-up
 * numbers: the login screen has no live data to show.
 */
export default function AdminAuthHero({ themeColor, logoUrl }) {
  const companyName = useCompanyName()
  const prefersReducedMotion = useReducedMotion()

  const fadeUp = (delay = 0) =>
    prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay, ease: "easeOut" },
        }

  const float = prefersReducedMotion
    ? {}
    : {
        animate: { y: [0, -10, 0] },
        transition: { duration: 6, repeat: Infinity, ease: "easeInOut" },
      }

  const pillars = [
    { icon: Store, label: "Multi-vendor", detail: "sellers, stock, payouts" },
    { icon: Zap, label: "Quick", detail: "rider, in minutes" },
    { icon: Truck, label: "Shipped", detail: "courier, tracked" },
    { icon: Coins, label: "Rewards", detail: "coins, spin, offers" },
  ]

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0B1410]">
      {/* Ambient wash */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-20 -top-24 h-80 w-80 rounded-full blur-3xl"
          style={{ backgroundColor: `${themeColor}33` }}
        />
        <div
          className="absolute -bottom-16 right-0 h-72 w-72 rounded-full blur-3xl"
          style={{ backgroundColor: `${themeColor}22` }}
        />
      </div>

      {/* Faint grid, kept low so the artwork stays the focus */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between p-8 xl:p-10">
        {/* Brand lockup */}
        <motion.div {...fadeUp(0)} className="flex items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="h-10 w-10 rounded-xl object-contain ring-1 ring-white/15"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          ) : null}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
              Admin Portal
            </p>
            <p className="text-lg font-bold leading-tight text-white">
              {companyName} <span style={{ color: themeColor }}>Admin</span>
            </p>
          </div>
        </motion.div>

        {/* Headline + artwork */}
        <div className="flex flex-col gap-7">
          <motion.div {...fadeUp(0.1)}>
            <h1 className="text-[2rem] font-bold leading-[1.15] tracking-tight text-white xl:text-[2.6rem]">
              Every store, one marketplace
              <span className="block" style={{ color: themeColor }}>
                delivered fast or shipped far
              </span>
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/55">
              Sellers, catalogue, orders, riders and couriers, payments and
              rewards: one console for the whole platform.
            </p>
          </motion.div>

          <motion.div {...fadeUp(0.18)} className="relative">
            <motion.div {...float}>
              <MarketplaceArt accent={themeColor} className="h-auto w-full max-w-[360px]" />
            </motion.div>
          </motion.div>

          <motion.div {...fadeUp(0.26)} className="grid max-w-md grid-cols-2 gap-2.5 xl:grid-cols-4">
            {pillars.map(({ icon: Icon, label, detail }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-sm"
              >
                <Icon
                  className="mb-2 h-4 w-4"
                  style={{ color: themeColor }}
                  aria-hidden="true"
                />
                <p className="text-sm font-bold text-white">{label}</p>
                <p className="mt-0.5 text-[10px] font-medium leading-snug text-white/45">{detail}</p>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.p {...fadeUp(0.32)} className="text-[11px] text-white/30">
          &copy; {new Date().getFullYear()} {companyName}
        </motion.p>
      </div>
    </div>
  )
}
