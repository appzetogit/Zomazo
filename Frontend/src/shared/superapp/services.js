import { ECOMMERCE_ENABLED, SERVICE_PROVIDER_ENABLED } from '../../config/features'

/**
 * The customer-facing services of the super app, in the order they are shown.
 *
 * One list, so every service's header offers the same way across to the
 * others. A service switched off for this build (see config/features.js) is
 * simply absent. `match` decides which entry is "current" for a path.
 */
export const SUPERAPP_SERVICES = [
  { key: 'food', label: 'Food', to: '/food/user', match: (p) => p.startsWith('/food') },
  { key: 'rides', label: 'Rides', to: '/taxi/user', match: (p) => p.startsWith('/taxi') },
  { key: 'quick', label: 'Quick', to: '/quick', match: (p) => p.startsWith('/quick') },
  ...(SERVICE_PROVIDER_ENABLED
    ? [{ key: 'services', label: 'Services', to: '/services', match: (p) => p === '/services' || /^\/services\/(?!vendor|worker)/.test(p) }]
    : []),
  ...(ECOMMERCE_ENABLED
    ? [{ key: 'shop', label: 'Shop', to: '/shop', match: (p) => p.startsWith('/shop') && !p.startsWith('/shop/seller') }]
    : []),
]

/** Every order, ride and booking the customer has, across all services. */
export const ALL_ORDERS_PATH = '/food/user/orders/all'

/** Help and tickets for any service. */
export const SUPPORT_PATH = '/food/user/profile/support'

export const currentServiceKey = (pathname) =>
  SUPERAPP_SERVICES.find((s) => s.match(pathname || ''))?.key || null
