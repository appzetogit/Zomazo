import { Briefcase, Home, User, Users, Wallet } from "lucide-react"
import { BASE } from "./vendorApi"

// The vendor's bottom tabs. Services lives under Profile to keep five thumb targets.
export const vendorNav = (pendingCount = 0) => [
  { to: BASE, label: "Home", icon: Home, end: true, badge: pendingCount },
  { to: `${BASE}/bookings`, label: "Bookings", icon: Briefcase },
  { to: `${BASE}/workers`, label: "Workers", icon: Users },
  { to: `${BASE}/wallet`, label: "Wallet", icon: Wallet },
  { to: `${BASE}/profile`, label: "Profile", icon: User },
]
