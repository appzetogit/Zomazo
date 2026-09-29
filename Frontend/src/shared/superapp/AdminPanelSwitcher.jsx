import { useMemo } from "react"
import { UtensilsCrossed, Truck, Wrench, ShoppingBasket, Pill, ShoppingBag, Settings2 } from "lucide-react"
import { useAdminAccess } from "@food/utils/adminAccess"
import { masterEntryFor, visibleAdminPanels } from "./adminPanels"

const PANEL_ICONS = {
  master: Settings2,
  food: UtensilsCrossed,
  taxi: Truck,
  serviceProvider: Wrench,
  quickCommerce: ShoppingBasket,
  medical: Pill,
  ecommerce: ShoppingBag,
}

/**
 * The service switcher for a dark admin sidebar: Master (when this admin may
 * open it), then every panel they were given (shared/superapp/adminPanels.js).
 *
 * `current` is the panel showing it. `onNavigate` moves within the host app's
 * router; without it each entry is a plain link, for panels that run on their
 * own router (the Shop admin), where the others are outside it.
 */
export default function AdminPanelSwitcher({ current, onNavigate }) {
  const access = useAdminAccess()
  const items = useMemo(() => {
    const master = masterEntryFor(access)
    return [
      ...(master ? [{ service: "master", label: "Master", path: master }] : []),
      ...visibleAdminPanels(access),
    ]
  }, [access])

  if (items.length < 2) return null

  return (
    <div className="grid grid-cols-4 gap-0.5 p-1 bg-neutral-800/40 backdrop-blur-sm rounded-xl mb-1 border border-white/5 shadow-inner">
      {items.map((item) => {
        const Icon = PANEL_ICONS[item.service] || Settings2
        const active = item.service === current
        const className = `min-w-0 flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 ${
          active
            ? "bg-white text-black shadow-[0_4px_12px_rgba(255,255,255,0.15)]"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5"
        }`
        const body = (
          <>
            <Icon className={`w-3.5 h-3.5 ${active ? "text-black" : "text-neutral-500"}`} />
            <span className="max-w-full truncate">{item.label}</span>
          </>
        )
        return onNavigate ? (
          <button key={item.service} type="button" onClick={() => onNavigate(item.path)} className={className}>
            {body}
          </button>
        ) : (
          <a key={item.service} href={item.path} className={className}>
            {body}
          </a>
        )
      })}
    </div>
  )
}
