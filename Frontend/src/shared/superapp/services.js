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

/** The super app's own home: every service, and what is on its way. */
export const HOME_PATH = '/home'

/**
 * The customer's account, shared by every service. These used to live under
 * /food/user, which made Food the shell; the old addresses redirect here.
 */
export const ACCOUNT_PATH = '/account'
export const ALL_ORDERS_PATH = '/account/orders'
export const SUPPORT_PATH = '/account/help'
export const INBOX_PATH = '/account/inbox'
export const WALLET_PATH = '/account/wallet'

/** The one sign-in for every customer app (modules/auth). */
export const LOGIN_PATH = '/login'

/*
 * Whose referral programme an invite link credits. Food and Taxi customers are
 * one account, but each pays referrals by its own rules, and the Shop keeps its
 * own. Food is the default, so a bare ?ref= keeps crediting what it always did.
 */
export const REFERRAL_VIA = ['food', 'taxi', 'shop']

/**
 * A friend's invite link: the platform sign-in with the code, and the service
 * whose programme it came from. Every service shares the same page, so a link
 * can never land on a sign-in screen that drops the code.
 */
export const inviteLink = (ref, via = 'food') => {
  const code = String(ref || '').trim()
  if (!code) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const params = new URLSearchParams({ ref: code })
  if (via && via !== 'food') params.set('via', via)
  return `${origin}${LOGIN_PATH}?${params.toString()}`
}

export const currentServiceKey = (pathname) =>
  SUPERAPP_SERVICES.find((s) => s.match(pathname || ''))?.key || null
