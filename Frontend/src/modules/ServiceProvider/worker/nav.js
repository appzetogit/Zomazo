import { Briefcase, Home, IndianRupee, User } from "lucide-react"
import { BASE } from "./workerApi"

export const workerNav = (requestCount = 0) => [
  { to: BASE, label: "Home", icon: Home, end: true, badge: requestCount },
  { to: `${BASE}/jobs`, label: "Jobs", icon: Briefcase },
  { to: `${BASE}/earnings`, label: "Earnings", icon: IndianRupee },
  { to: `${BASE}/profile`, label: "Profile", icon: User },
]
