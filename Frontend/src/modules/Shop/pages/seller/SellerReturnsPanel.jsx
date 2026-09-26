import { useEffect, useState } from "react"
import { ChevronDown, PackageX } from "lucide-react"
import { sellerAPI } from "@store/api"

const STATUS_CLS = {
  requested: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
  received: "bg-indigo-50 text-indigo-700",
  refunded: "bg-green-50 text-green-700",
}

/** Read-only list of customer returns on this store's courier orders (reviewed by the admin). */
export default function SellerReturnsPanel() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let cancelled = false
    sellerAPI.getReturns({ limit: 20 })
      .then((res) => {
        if (cancelled) return
        setRows(res?.data?.data?.data || [])
        setTotal(res?.data?.data?.meta?.total || 0)
      })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [])

  if (!rows || total === 0) return null

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <PackageX className="w-4 h-4 text-gray-500" /> Customer returns ({total})
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {rows.map((r) => (
            <li key={r._id} className="px-4 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800">#{r.orderReadableId}</span>
                <span className={`px-2 py-0.5 rounded-full ${STATUS_CLS[r.status] || "bg-gray-50 text-gray-700"}`}>{r.status}</span>
              </div>
              <p className="text-gray-600 mt-0.5">
                {(r.items || []).map((i) => `${i.quantity} × ${i.name}`).join(", ")}
              </p>
              <p className="text-gray-500">
                {r.reason} · {new Date(r.createdAt).toLocaleDateString("en-IN")}
                {r.reverseShipment?.awb ? ` · pickup AWB ${r.reverseShipment.awb}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
