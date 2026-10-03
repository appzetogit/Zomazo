import { useMemo } from "react"
import "./adminSidebarPalette.css"
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
 * The service switcher for an admin sidebar (light --sb-* palette): Master (when this admin may
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
    <div className="admin-sb-palette grid grid-cols-4 gap-1 p-1.5 bg-[var(--sb-surface-raised)] backdrop-blur-sm rounded-xl mb-1 border border-[var(--sb-border)] shadow-inner">
      {items.map((item) => {
        const Icon = PANEL_ICONS[item.service] || Settings2
        const active = item.service === current
        const className = `min-w-0 overflow-hidden flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none font-bold rounded-lg transition-all duration-300 ${
          active
            ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
            : "text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)]"
        }`
        const body = (
          <>
            <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-faint)]"}`} />
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
