import { useEffect } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Bell, ChevronRight, Gift, LifeBuoy, LogOut, Pencil, Receipt, Tag, Wallet } from "lucide-react"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { ALL_ORDERS_PATH, HOME_PATH, INBOX_PATH, SUPPORT_PATH, WALLET_PATH } from "@/shared/superapp/services"
import { useAccount } from "./useAccount"

/**
 * The one account screen. Every service's profile links here for what belongs
 * to the customer rather than to a service: who they are, the wallet they pay
 * with everywhere, every order, help, and the inbox. Service-specific settings
 * (a ride's saved places, the Shop's returns) stay in those services.
 */
const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

export default function AccountHub() {
  const brand = useCompanyName()
  useEffect(() => {
    document.title = `Your account | ${brand}`
  }, [brand])
  const { user, balance } = useAccount()
  const name = String(user?.name || "").trim()
  const photo = user?.profileImage?.url || user?.profileImage || ""

  const rows = [
    { to: ALL_ORDERS_PATH, Icon: Receipt, label: "Orders", sub: "Food, rides, groceries, services and the Shop" },
    { to: WALLET_PATH, Icon: Wallet, label: "Wallet", sub: balance === null ? `One balance across ${brand}` : `${money(balance)} · one balance across ${brand}` },
    { to: INBOX_PATH, Icon: Bell, label: "Inbox", sub: "Updates from every service" },
    { to: SUPPORT_PATH, Icon: LifeBuoy, label: "Help", sub: "Raise a ticket about anything" },
    { to: "/food/user/profile/refer-earn", Icon: Gift, label: "Refer & earn", sub: "Invite friends" },
    { to: "/food/user/profile/coupons", Icon: Tag, label: "Coupons", sub: "Offers you can use" },
  ]

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-10">
      <header className="flex items-center gap-3 bg-white px-4 py-4 shadow-sm">
        <Link to={HOME_PATH} aria-label="Back to home" className="rounded-full p-1.5 text-gray-700 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[18px] font-bold text-gray-900">Your account</h1>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-5">
        <section className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-100 text-xl font-bold text-orange-600">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : (name[0] || "?").toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-bold text-gray-900">{name || "Your name"}</span>
            <span className="block truncate text-[13px] text-gray-500">{[user?.phone, user?.email].filter(Boolean).join(" · ")}</span>
          </span>
          <Link to="/food/user/profile/edit" aria-label="Edit profile" className="rounded-full border border-gray-200 p-2 text-gray-700 hover:bg-gray-50">
            <Pencil className="h-4 w-4" />
          </Link>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          {rows.map(({ to, Icon, label, sub }, i) => (
            <Link key={label} to={to} className={`flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 ${i ? "border-t border-gray-100" : ""}`}>
              <Icon className="h-5 w-5 shrink-0 text-gray-700" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-gray-900">{label}</span>
                <span className="block truncate text-[12px] text-gray-500">{sub}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            </Link>
          ))}
        </section>

        <Link to="/food/user/profile/logout" className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-3 text-[15px] font-semibold text-red-600">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </Link>
      </main>
    </div>
  )
}
