/**
 * Admin: first-order offer claims (one per person, recognised by account,
 * phone, device or payment instrument). Flagged claims are ones whose payment
 * matched another person's claim after payment. "Release" gives the offer back;
 * the server allows it only when the claim's order was cancelled or is gone.
 */
import { useCallback, useEffect, useState } from "react"
import { Flag, Loader2, RefreshCw, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@store/api"

const PAGE_SIZE = 20
const SIGNAL_LABELS = { account: "Account", phone: "Phone", device: "Device", payment: "Payment" }

const fmtDateTime = (d) => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(d))
  } catch {
    return "-"
  }
}

const shortId = (id) => (id ? `#${String(id).slice(-8)}` : "")

export default function FirstOrderClaims() {
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } })
  const [loading, setLoading] = useState(true)
  const [releasing, setReleasing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: PAGE_SIZE }
      if (flaggedOnly) params.flagged = true
      const res = await adminAPI.getFirstOrderClaims(params)
      const body = res?.data?.data || {}
      setData({
        items: Array.isArray(body.items) ? body.items : [],
        pagination: body.pagination || { page: 1, totalPages: 1, total: 0 },
      })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load first-order claims")
      setData({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } })
    } finally {
      setLoading(false)
    }
  }, [page, flaggedOnly])

  useEffect(() => {
    load()
  }, [load])

  const release = async (claim) => {
    const who = claim.user?.name || claim.user?.phone || "this customer"
    if (!window.confirm(`Release the first-order claim for ${who}? They will be able to use a first-order offer again.`)) return
    setReleasing(claim._id)
    try {
      await adminAPI.releaseFirstOrderClaim(claim._id)
      toast.success("Claim released")
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to release claim")
    } finally {
      setReleasing(null)
    }
  }

  const { total = 0, totalPages = 1 } = data.pagination || {}

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">First-order Claims</h1>
          <p className="mt-1 text-sm text-slate-500">
            Each person gets one first-order offer. A claim can be released once its order is cancelled.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => {
                setFlaggedOnly(e.target.checked)
                setPage(1)
              }}
            />
            Flagged only
          </label>
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
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Signals</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Flagged</th>
                <th className="px-4 py-3">Created</th>
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
                    {flaggedOnly ? "No flagged claims." : "No first-order claims yet."}
                  </td>
                </tr>
              ) : (
                data.items.map((claim) => {
                  const signals = Object.entries(claim.signals || {})
                    .filter(([, on]) => on)
                    .map(([key]) => SIGNAL_LABELS[key] || key)
                  return (
                    <tr key={claim._id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{claim.user?.name || "-"}</p>
                        <p className="text-xs text-slate-500">{claim.user?.phone || ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {signals.length
                            ? signals.map((s) => (
                                <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                  {s}
                                </span>
                              ))
                            : "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {claim.orderId ? (
                          <span title={String(claim.orderId)}>Order {shortId(claim.orderId)}</span>
                        ) : claim.checkoutId ? (
                          <span title={String(claim.checkoutId)}>Checkout {shortId(claim.checkoutId)}</span>
                        ) : (
                          "-"
                        )}
                        {claim.offerCode && <p className="text-xs text-slate-500">Offer {claim.offerCode}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {claim.flagged ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700" title={claim.flagReason || ""}>
                            <Flag className="h-3 w-3" aria-hidden="true" />
                            Flagged
                          </span>
                        ) : (
                          <span className="text-slate-400">No</span>
                        )}
                        {claim.flagged && claim.flagReason && (
                          <p className="mt-1 max-w-[220px] text-xs text-slate-500">{claim.flagReason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDateTime(claim.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={releasing === claim._id}
                          onClick={() => release(claim)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {releasing === claim._id ? "Releasing..." : "Release"}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>
            {total} claim{total === 1 ? "" : "s"}
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
