import { Link, useLocation } from "react-router-dom"
import { Home, LayoutGrid, Store, Package, User } from "lucide-react"
import { useCart } from "@store/context/CartContext"
import { useStoreMode } from "@store/context/StoreModeContext"

/**
 * Modern 5-tab bottom navigation matching the fashion multi-vendor reference design:
 * Home | Categories | Stores | Orders | Account
 */
export default function BottomNav() {
  const { pathname } = useLocation()
  const { storePath } = useStoreMode()
  const { getCartCount } = useCart()
  const cartCount = getCartCount()

  const home = storePath("/")
  const isHome = (p) => p === home || p === "/" || p === "/quick" || p === "/shop"

  const account = {
    to: "/profile",
    label: "Account",
    icon: User,
    match: (p) => p.startsWith("/profile") || p.startsWith("/user/profile"),
  }

  // One tab bar for Shop and Quick; each tab stays inside the current store.
  const items = [
    { to: home, label: "Home", icon: Home, match: isHome },
    {
      to: storePath("/categories"),
      label: "Categories",
      icon: LayoutGrid,
      match: (p) => /\/(categories|category)/.test(p),
    },
    {
      to: storePath("/sellers"),
      label: "Stores",
      icon: Store,
      match: (p) => /\/(sellers|stores)/.test(p),
    },
    {
      to: "/orders",
      label: "Orders",
      icon: Package,
      match: (p) => p.startsWith("/orders"),
    },
    account,
  ]

  // Pages with their own pinned action bar (Add to Cart, checkout) hide the tabs.
  if (/\/product\/|\/cart(\/|$)/.test(pathname)) return null

  return (
    <nav
      aria-label="Main Navigation"
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-gray-200/80 dark:border-gray-800 bg-white/95 dark:bg-[#161616]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
    >
      <ul className="mx-auto flex h-[58px] max-w-lg items-stretch">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname)
          return (
            <li key={label} className="flex-1">
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-all duration-200 ${
                  active
                    ? "text-orange-500 font-bold"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-medium"
                }`}
              >
                <div className="relative">
                  <Icon
                    className={`h-5 w-5 transition-transform duration-200 ${
                      active ? "scale-110 stroke-[2.2]" : "stroke-[1.8]"
                    }`}
                    aria-hidden="true"
                  />
                  {label === "Orders" && cartCount > 0 ? (
                    <span className="sr-only">({cartCount} items in cart)</span>
                  ) : null}
                </div>
                <span className="leading-none">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

