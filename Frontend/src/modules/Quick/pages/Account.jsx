import { Link } from "react-router-dom"
import { ChevronRight, Gift, Heart, HelpCircle, LogIn, Package, Receipt, Store } from "lucide-react"
import { ALL_ORDERS_PATH, SUPPORT_PATH } from "@/shared/superapp/services"
import SuperAppSwitcher from "@/shared/superapp/SuperAppSwitcher"
import { cx, focusRing, isSignedIn } from "../helpers"

/**
 * The customer's Quick menu, behind the header's account button: this
 * service's orders and favourites, the platform-wide pages (every order,
 * help), and refer & earn.
 */
const ITEMS = [
  { to: "/quick/orders", icon: Package, label: "Your quick orders", hint: "Track, rate and reorder" },
  { to: ALL_ORDERS_PATH, icon: Receipt, label: "All orders", hint: "Food, rides, services, shop and quick in one place" },
  { to: "/quick/favorites", icon: Heart, label: "Favourites", hint: "Products and stores you saved" },
  { to: "/quick/stores", icon: Store, label: "All stores", hint: "Every store delivering to you" },
  { to: "/quick/refer", icon: Gift, label: "Refer & earn", hint: "Invite friends, get wallet cash" },
  { to: SUPPORT_PATH, icon: HelpCircle, label: "Help & support", hint: "Questions about an order, payments or refunds" },
]

export default function Account() {
  const signedIn = isSignedIn()
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3 px-3 py-3 lg:px-6">
      <h1 className="px-1 text-[20px] font-black tracking-tight text-wh-text">Account</h1>
      <SuperAppSwitcher accent="#B45309" className="px-1" />
      {!signedIn ? (
        <Link to="/login" state={{ from: { pathname: "/quick/account" } }}
          className={cx("flex items-center gap-3 rounded-[10px] bg-wh-brand-ink p-4 text-white", focusRing)}>
          <LogIn className="h-5 w-5" aria-hidden="true" />
          <span className="flex-1 text-[15px] font-bold">Sign in for orders, favourites and rewards</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
      <ul className="overflow-hidden rounded-[10px] bg-wh-surface">
        {ITEMS.map(({ to, icon: Icon, label, hint }) => (
          <li key={to} className="border-b border-wh-border last:border-b-0">
            <Link to={to} className={cx("flex items-center gap-3 p-4 hover:bg-wh-brand-50", focusRing)}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wh-brand-50"><Icon className="h-5 w-5 text-wh-brand-ink" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-wh-text">{label}</span>
                <span className="block truncate text-[12px] text-wh-muted">{hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-wh-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
