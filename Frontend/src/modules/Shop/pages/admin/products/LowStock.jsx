/**
 * Admin: products and variants at or below their low-stock alert, for the
 * current panel's channel (Quick panel -> quick stock, Shop panel -> shop
 * stock). Filter by seller; each row links to the product's edit form.
 */
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, Loader2, Pencil, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@store/api"
import { useAdminBase, useAdminPanel } from "@store/components/admin/useAdminPanel"

const PAGE_SIZE = 50

export default function LowStock() {
  const { channel, label: panelLabel } = useAdminPanel()
  const adminBase = useAdminBase()
  const [sellers, setSellers] = useState([])
  const [sellerId, setSellerId] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI
      .getSellers({ limit: 1000 })
      .then((res) => {
        const list = res?.data?.data?.sellers || res?.data?.sellers || []
        setSellers(
          (Array.isArray(list) ? list : [])
            .map((s) => ({ id: String(s._id || s.id || ""), name: s.sellerName || s.name || "Seller" }))
            .filter((s) => s.id)
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      })
      .catch(() => setSellers([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { channel, page, limit: PAGE_SIZE }
      if (sellerId) params.sellerId = sellerId
      const res = await adminAPI.getLowStock(params)
      const body = res?.data?.data || {}
      setData({
        items: Array.isArray(body.items) ? body.items : [],
        pagination: body.pagination || { page: 1, totalPages: 1, total: 0 },
      })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load low stock")
      setData({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } })
    } finally {
      setLoading(false)
    }
  }, [channel, page, sellerId])

  useEffect(() => {
    load()
  }, [load])

  const editLink = (row) => {
    const params = new URLSearchParams({ productId: row.productId, edit: "1" })
    if (row.sellerId) params.set("sellerId", row.sellerId)
    const baseName = row.variantName ? row.name.replace(` (${row.variantName})`, "") : row.name
    if (baseName) params.set("search", baseName)
    return `${adminBase}/products?${params.toString()}`
  }

  const { total = 0, totalPages = 1 } = data.pagination || {}

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
            Low Stock ({panelLabel})
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Products and variants whose {panelLabel} stock is at or below their low-stock alert.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sellerId}
            onChange={(e) => {
              setSellerId(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            aria-label="Filter by seller"
          >
            <option value="">All sellers</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Seller</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">In stock</th>
                <th className="px-4 py-3 text-right">Alert at</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" aria-hidden="true" />
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    Nothing is running low in {panelLabel}.
                  </td>
                </tr>
              ) : (
                data.items.map((row) => (
                  <tr key={`${row.productId}-${row.variantId || "p"}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {row.image ? (
                          <img src={row.image} alt="" className="h-9 w-9 rounded-lg object-cover" />
                        ) : (
                          <div className="h-9 w-9 rounded-lg bg-slate-100" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{row.name}</p>
                          {row.variantId && <p className="text-xs text-slate-500">Variant</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.sellerName || "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{row.categoryName || "-"}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${row.qty === 0 ? "text-rose-600" : "text-amber-700"}`}>
                      {row.qty}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{row.threshold}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={editLink(row)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>
            {total} item{total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
