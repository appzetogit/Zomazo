import { useEffect } from "react"
import { Link } from "react-router-dom"
import { Bell, Car, ChevronRight, Gift, LifeBuoy, Receipt, ShoppingBag, User, Utensils, Wallet, Wrench, Zap } from "lucide-react"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { ACCOUNT_PATH, ALL_ORDERS_PATH, INBOX_PATH, SUPERAPP_SERVICES, SUPPORT_PATH, WALLET_PATH } from "@/shared/superapp/services"
import { useAccount } from "./useAccount"

/**
 * The super app's home. Every service sits side by side here, rather than the
 * customer landing inside Food and finding the rest from its header, and what
 * is on its way -- from any service -- is shown first.
 */
const SERVICE_LOOK = {
  food: { Icon: Utensils, blurb: "Restaurants near you", tint: "bg-red-50 text-red-600" },
  rides: { Icon: Car, blurb: "Cabs, bikes, parcels", tint: "bg-blue-50 text-blue-600" },
  quick: { Icon: Zap, blurb: "Groceries in minutes", tint: "bg-amber-50 text-amber-600" },
  services: { Icon: Wrench, blurb: "Home services", tint: "bg-violet-50 text-violet-600" },
  shop: { Icon: ShoppingBag, blurb: "Shop online", tint: "bg-emerald-50 text-emerald-600" },
}

const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

export default function SuperAppHome() {
  const brand = useCompanyName()
  useEffect(() => {
    document.title = brand
  }, [brand])
  const { signedIn, user, balance, ongoing } = useAccount({ withOngoing: true })
  const firstName = String(user?.name || "").trim().split(/\s+/)[0]

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-10">
      <header className="bg-white px-4 pb-4 pt-5 shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-gray-500">{brand}</p>
            <h1 className="truncate text-[22px] font-extrabold text-gray-900">
              {firstName ? `Hi, ${firstName}` : "What do you need today?"}
            </h1>
          </div>
          {signedIn ? (
            <div className="flex shrink-0 items-center gap-2">
              <Link to={INBOX_PATH} aria-label="Inbox" className="rounded-full border border-gray-200 p-2.5 text-gray-700 hover:bg-gray-50">
                <Bell className="h-5 w-5" />
              </Link>
              <Link to={ACCOUNT_PATH} aria-label="Your account" className="rounded-full border border-gray-200 p-2.5 text-gray-700 hover:bg-gray-50">
                <User className="h-5 w-5" />
              </Link>
            </div>
          ) : (
            <Link to="/login" className="shrink-0 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-5">
        {ongoing.length ? (
          <section aria-labelledby="on-its-way">
            <h2 id="on-its-way" className="mb-2 text-[15px] font-bold text-gray-900">On its way</h2>
            <div className="flex flex-col gap-2">
              {ongoing.map((item) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{item.serviceLabel}</p>
                      <p className="truncate font-semibold text-gray-900">{item.title}</p>
                      <p className="text-[13px] text-[#EB590E]">{item.statusLabel}</p>
                    </div>
                    {item.route ? <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" /> : null}
                  </>
                )
                const cls = "flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm"
                return item.route
                  ? <Link key={item.key} to={item.route} className={cls}>{body}</Link>
                  : <div key={item.key} className={cls}>{body}</div>
              })}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="services">
          <h2 id="services" className="mb-2 text-[15px] font-bold text-gray-900">Services</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SUPERAPP_SERVICES.map((s) => {
              const look = SERVICE_LOOK[s.key] || SERVICE_LOOK.food
              return (
                <Link key={s.key} to={s.to} className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition active:scale-[0.98]">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${look.tint}`}>
                    <look.Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[16px] font-bold text-gray-900">{s.label}</span>
                    <span className="block text-[12px] text-gray-500">{look.blurb}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </section>

        {signedIn ? (
          <section aria-labelledby="yours" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <h2 id="yours" className="sr-only">Your account</h2>
            {[
              { to: WALLET_PATH, Icon: Wallet, label: "Wallet", sub: balance === null ? "" : money(balance) },
              { to: ALL_ORDERS_PATH, Icon: Receipt, label: "All orders", sub: "Every service" },
              { to: SUPPORT_PATH, Icon: LifeBuoy, label: "Help", sub: "Raise a ticket" },
              { to: "/food/user/profile/refer-earn", Icon: Gift, label: "Refer & earn", sub: "Invite friends" },
            ].map(({ to, Icon, label, sub }) => (
              <Link key={label} to={to} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm">
                <Icon className="h-5 w-5 shrink-0 text-gray-700" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-gray-900">{label}</span>
                  {sub ? <span className="block truncate text-[12px] text-gray-500">{sub}</span> : null}
                </span>
              </Link>
            ))}
          </section>
        ) : null}
      </main>
    </div>
  )
}
