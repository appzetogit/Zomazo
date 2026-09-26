import { NavLink } from "react-router-dom"
import { useAdminBase } from "@store/components/admin/useAdminPanel"

/** Tabs across the courier pages: all shipments, the NDR queue, the RTO queue, COD remittances. */
export default function ShipmentTabs() {
  const base = useAdminBase()
  const tabs = [
    ["/shipments", "All shipments"],
    ["/shipments/ndr", "NDR (failed attempts)"],
    ["/shipments/rto", "RTO (returning)"],
    ["/cod-remittances", "COD remittances"],
  ]
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 text-sm">
      {tabs.map(([path, label]) => (
        <NavLink
          key={path}
          end
          to={`${base}${path}`}
          className={({ isActive }) => `px-3 py-2 -mb-px border-b-2 ${isActive ? "border-slate-900 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          {label}
        </NavLink>
      ))}
    </div>
  )
}
