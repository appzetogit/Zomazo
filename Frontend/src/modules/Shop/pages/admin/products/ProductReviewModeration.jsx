/**
 * Admin: product review moderation for the current panel (quick/shop reviews
 * are the channel the reviewed order was delivered in). Hide / unhide / delete,
 * each with a reason. Reported reviews can be listed first.
 */
import { useCallback, useEffect, useState } from "react"
import { Eye, EyeOff, Flag, Loader2, MessageSquareText, Search, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@store/components/ui/dialog"
import { adminAPI } from "@store/api"
import { useAdminPanel } from "@store/components/admin/useAdminPanel"

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "reported", label: "Reported" },
  { key: "visible", label: "Visible" },
  { key: "hidden", label: "Hidden" },
  { key: "removed", label: "Deleted" },
]

const STATUS_BADGE = {
  visible: "bg-emerald-50 text-emerald-700 border-emerald-200",
  hidden: "bg-amber-50 text-amber-800 border-amber-200",
  removed: "bg-rose-50 text-rose-700 border-rose-200",
}

const ACTION_COPY = {
  hide: { title: "Hide review", verb: "Hide", reasonRequired: true, done: "Review hidden" },
  unhide: { title: "Restore review", verb: "Restore", reasonRequired: false, done: "Review restored" },
  delete: { title: "Delete review", verb: "Delete", reasonRequired: true, done: "Review deleted" },
}

const fmtDate = (d) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d))
  } catch {
    return "-"
  }
}

function Stars({ rating }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} aria-hidden="true" className={`h-3.5 w-3.5 ${i < rating ? "fill-amber-500 text-amber-500" : "text-slate-300"}`} />
      ))}
    </span>
  )
}

export default function ProductReviewModeration() {
  const { fulfilmentMode, label: panelLabel } = useAdminPanel()
  const [status, setStatus] = useState("all")
  const [rating, setRating] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ reviews: [], pagination: { page: 1, totalPages: 1, total: 0 } })
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState(null) // { type, review }
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getProductReviews({
        status, fulfilmentMode, rating: rating || undefined, search: search || undefined, page, limit: 20,
      })
      setData(res?.data?.data || { reviews: [], pagination: { page: 1, totalPages: 1, total: 0 } })
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load product reviews")
    } finally {
      setLoading(false)
    }
  }, [status, fulfilmentMode, rating, search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [status, rating, search, fulfilmentMode])

  const openAction = (type, review) => {
    setAction({ type, review })
    setReason("")
  }

  const confirm = async () => {
    if (!action) return
    const copy = ACTION_COPY[action.type]
    if (copy.reasonRequired && !reason.trim()) {
      toast.error("Enter a reason")
      return
    }
    setSubmitting(true)
    try {
      const id = action.review.id
      if (action.type === "hide") await adminAPI.hideProductReview(id, reason.trim())
      else if (action.type === "unhide") await adminAPI.unhideProductReview(id, reason.trim())
      else await adminAPI.deleteProductReview(id, reason.trim())
      toast.success(copy.done)
      setAction(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.message || "Action failed")
    } finally {
      setSubmitting(false)
    }
  }

  const { reviews, pagination } = data
  const copy = action ? ACTION_COPY[action.type] : null

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-wh-brand-ink" aria-hidden="true" />
              <h1 className="text-2xl font-bold text-slate-900">Product Reviews</h1>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{pagination?.total ?? 0}</span>
              <span className="rounded-full bg-wh-brand-50 px-3 py-1 text-xs font-semibold text-wh-brand-ink">{panelLabel} orders</span>
            </div>
            <form
              className="relative min-w-[250px]"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()) }}
              role="search"
            >
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search product or review text"
                aria-label="Search reviews"
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            </form>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                aria-pressed={status === t.key}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  status === t.key ? "border-wh-brand bg-wh-brand text-wh-text" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-slate-600">
              Rating
              <select value={rating} onChange={(e) => setRating(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Any</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star</option>)}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-3">Product</th>
                  <th className="px-3 py-3">Review</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" aria-label="Loading" /></td></tr>
                ) : reviews.length === 0 ? (
                  <tr><td colSpan={5} className="py-16 text-center text-slate-500">No reviews found</td></tr>
                ) : reviews.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-2">
                        {r.productImage ? <img src={r.productImage} alt="" className="h-10 w-10 rounded border border-slate-200 object-cover" /> : null}
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-medium text-slate-900">{r.productName || "Product"}</p>
                          <p className="text-xs text-slate-500">{r.sellerName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[380px] px-3 py-3">
                      <Stars rating={r.rating} />
                      {r.title ? <p className="mt-1 font-semibold text-slate-900">{r.title}</p> : null}
                      {r.text ? <p className="mt-1 line-clamp-4 whitespace-pre-line text-slate-700">{r.text}</p> : null}
                      {r.images?.length ? (
                        <div className="mt-2 flex gap-1">
                          {r.images.map((url) => (
                            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt="Review photo" className="h-10 w-10 rounded border border-slate-200 object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {r.reply ? <p className="mt-2 border-l-2 border-slate-300 pl-2 text-xs text-slate-600">Seller: {r.reply.text}</p> : null}
                      {r.reportCount > 0 ? (
                        <details className="mt-2 text-xs text-rose-700">
                          <summary className="inline-flex cursor-pointer items-center gap-1 font-semibold">
                            <Flag className="h-3 w-3" aria-hidden="true" /> Reported {r.reportCount}×
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-slate-600">
                            {r.reports.map((rep, i) => <li key={i}>{rep.byRole === "SELLER" ? "Seller" : "Customer"}: {rep.reason}</li>)}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-slate-900">{r.customerName}</p>
                      <p className="text-xs text-slate-500">{fmtDate(r.createdAt)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[r.status] || ""}`}>
                        {r.status === "removed" ? "deleted" : r.status}
                      </span>
                      {r.moderationReason ? <p className="mt-1 max-w-[180px] text-xs text-slate-500">{r.moderationReason}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        {r.status === "visible" ? (
                          <button type="button" onClick={() => openAction("hide", r)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Hide
                          </button>
                        ) : null}
                        {r.status === "hidden" ? (
                          <button type="button" onClick={() => openAction("unhide", r)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Unhide
                          </button>
                        ) : null}
                        {r.status !== "removed" ? (
                          <button type="button" onClick={() => openAction("delete", r)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination?.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
              <span className="text-slate-600">Page {pagination.page} of {pagination.totalPages}</span>
              <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={Boolean(action)} onOpenChange={(open) => { if (!open) setAction(null) }}>
        <DialogContent className="bg-white p-6">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>
              {action?.type === "delete"
                ? "The review is removed for good and the customer can't post it again. It stays in the moderation log."
                : action?.type === "hide"
                  ? "The review is taken off the product page and out of its rating until restored."
                  : "The review goes back on the product page and into its rating."}
            </DialogDescription>
          </DialogHeader>
          <label className="mt-2 block text-sm font-medium text-slate-700" htmlFor="moderation-reason">
            Reason{copy?.reasonRequired ? "" : " (optional)"}
          </label>
          <textarea
            id="moderation-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <DialogFooter className="mt-4">
            <button type="button" onClick={() => setAction(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
            <button
              type="button"
              disabled={submitting}
              onClick={confirm}
              className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${action?.type === "delete" ? "bg-rose-600 text-white" : "bg-wh-brand text-wh-text"}`}
            >
              {submitting ? "Saving…" : copy?.verb}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
