import { Link, useLocation } from 'react-router-dom'
import { Bike, Car, Receipt, ShoppingBag, Utensils, Wrench, Zap } from 'lucide-react'
import { ALL_ORDERS_PATH, SUPERAPP_SERVICES, currentServiceKey } from './services'

const ICONS = { food: Utensils, rides: Car, quick: Zap, services: Wrench, shop: ShoppingBag, delivery: Bike }

/**
 * A row of pills to move between the super app's services, for any service's
 * header. The current service is highlighted; `showOrders` adds a shortcut to
 * the cross-service All orders page.
 *
 * Plain links (not navigate calls) so they work with modifier-click and are
 * read as navigation by assistive tech.
 */
export default function SuperAppSwitcher({ className = '', showOrders = false, accent = '#EB590E' }) {
  const { pathname } = useLocation()
  const current = currentServiceKey(pathname)

  return (
    <nav aria-label="Services" className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar ${className}`}>
      {SUPERAPP_SERVICES.map((s) => {
        const Icon = ICONS[s.key]
        const active = s.key === current
        return (
          <Link
            key={s.key}
            to={s.to}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
              active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:text-gray-900'
            }`}
            style={active ? { backgroundColor: accent } : undefined}
          >
            {Icon ? <Icon className="w-3.5 h-3.5" aria-hidden="true" /> : null}
            {s.label}
          </Link>
        )
      })}
      {showOrders ? (
        <Link
          to={ALL_ORDERS_PATH}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-white text-gray-600 border-gray-200 hover:text-gray-900"
        >
          <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
          All orders
        </Link>
      ) : null}
    </nav>
  )
}
