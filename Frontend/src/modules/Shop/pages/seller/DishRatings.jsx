/**
 * Seller app: customer reviews of this store's products (route
 * /seller/dish-ratings). Filter by stars or "awaiting reply", reply once per
 * review (shown publicly under it), or report an abusive one to the admins.
 */
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Flag, Loader2, MessageSquareReply, Star } from "lucide-react"
import { toast } from "sonner"
import useSellerBackNavigation from "@store/hooks/useSellerBackNavigation"
import { sellerAPI } from "@store/api"
import { StarDisplay } from "@store/components/user/reviews/StarRating"

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unreplied", label: "Awaiting reply" },
  { key: "5", label: "5★" },
  { key: "4", label: "4★" },
  { key: "3", label: "3★" },
  { key: "2", label: "2★" },
  { key: "1", label: "1★" },
]

const dateFmt = (d) => {
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d))
  } catch {
    return ""
  }
}

function ReviewCard({ review, onReplied }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  const sendReply = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      const res = await sellerAPI.replyToProductReview(review.id, text.trim())
      onReplied(review.id, res?.data?.data?.reply || { text: text.trim(), at: new Date().toISOString() })
      setOpen(false)
      toast.success("Reply posted")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not post your reply")
    } finally {
      setBusy(false)
    }
  }

  const report = async () => {
    const reason = window.prompt("Why should the admins look at this review?")
    if (!reason || !reason.trim()) return
    try {
      const res = await sellerAPI.reportProductReview(review.id, reason.trim())
      toast.success(res?.data?.data?.alreadyReported ? "You already reported this review" : "Reported to the admins")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not report this review")
    }
  }

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {review.productImage ? (
          <img src={review.productImage} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-gray-100 object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-sm font-semibold text-gray-900">{review.productName || "Product"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StarDisplay rating={review.rating} size="h-3.5 w-3.5" />
            <span className="text-xs text-gray-500">{review.customerName} · {dateFmt(review.createdAt)}</span>
            {review.status === "hidden" ? (
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-700">Hidden by admin</span>
            ) : null}
          </div>
        </div>
      </div>
      {review.variantName ? <p className="mt-2 text-xs text-gray-500">Option: {review.variantName}</p> : null}
      {review.title ? <p className="mt-2 text-sm font-bold text-gray-900">{review.title}</p> : null}
      {review.text ? <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{review.text}</p> : null}
      {review.images?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {review.images.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
              <img src={url} alt="Customer photo" className="h-full w-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}

      {review.reply ? (
        <div className="mt-3 rounded-lg border-l-4 border-wh-brand bg-wh-brand-50 px-3 py-2">
          <p className="text-xs font-bold text-gray-800">Your reply · {dateFmt(review.reply.at)}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{review.reply.text}</p>
        </div>
      ) : open ? (
        <form onSubmit={sendReply} className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-gray-700" htmlFor={`reply-${review.id}`}>
            Your public reply (you can reply once)
          </label>
          <textarea
            id={`reply-${review.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-wh-brand"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="rounded-full bg-wh-brand px-4 py-1.5 text-xs font-semibold text-wh-text disabled:opacity-50"
            >
              {busy ? "Posting…" : "Post reply"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-3 flex items-center gap-4 text-xs">
        {!review.reply && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-semibold text-wh-brand-ink">
            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" /> Reply
          </button>
        ) : null}
        <button type="button" onClick={report} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
          <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Report
        </button>
        {review.helpfulCount > 0 ? <span className="text-gray-500">{review.helpfulCount} found helpful</span> : null}
      </div>
    </li>
  )
}

export default function DishRatings() {
  const goBack = useSellerBackNavigation()
  const [filter, setFilter] = useState("all")
  const [reviews, setReviews] = useState([])
  const [summary, setSummary] = useState(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true)
    const params = { page: nextPage, limit: 20 }
    if (filter === "unreplied") params.replied = "false"
    else if (filter !== "all") params.rating = filter
    try {
      const res = await sellerAPI.getProductReviews(params)
      const d = res?.data?.data || {}
      setSummary(d.summary || null)
      setTotalPages(d.pagination?.totalPages || 1)
      setPage(nextPage)
      setReviews((prev) => (nextPage === 1 ? d.reviews || [] : [...prev, ...(d.reviews || [])]))
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not load reviews")
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load(1) }, [load])

  const onReplied = (id, reply) => {
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, reply } : r)))
    setSummary((s) => (s ? { ...s, awaitingReply: Math.max(0, (s.awaitingReply || 0) - 1) } : s))
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={goBack} className="rounded-lg p-1.5 transition-colors hover:bg-gray-100" aria-label="Go back">
            <ArrowLeft className="h-6 w-6 text-gray-900" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Product reviews</h1>
            <p className="text-xs text-gray-500">What customers say about your products</p>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                filter === f.key ? "border-wh-brand bg-wh-brand text-wh-text" : "border-gray-300 bg-white text-gray-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {summary ? (
        <div className="mx-4 mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white p-3">
            <p className="flex items-center justify-center gap-1 text-lg font-bold text-gray-900">
              {Number(summary.averageRating || 0).toFixed(1)} <Star className="h-4 w-4 fill-wh-brand text-wh-brand" aria-hidden="true" />
            </p>
            <p className="text-[11px] text-gray-500">Average</p>
          </div>
          <div className="rounded-xl bg-white p-3">
            <p className="text-lg font-bold text-gray-900">{summary.totalReviews || 0}</p>
            <p className="text-[11px] text-gray-500">Reviews</p>
          </div>
          <div className="rounded-xl bg-white p-3">
            <p className="text-lg font-bold text-gray-900">{summary.awaitingReply || 0}</p>
            <p className="text-[11px] text-gray-500">Awaiting reply</p>
          </div>
        </div>
      ) : null}

      <div className="flex-1 px-4 py-4">
        {loading && !reviews.length ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-label="Loading" /></div>
        ) : reviews.length ? (
          <ul className="space-y-3">
            {reviews.map((r) => <ReviewCard key={r.id} review={r} onReplied={onReplied} />)}
          </ul>
        ) : (
          <p className="py-16 text-center text-sm text-gray-600">
            {filter === "all" ? "You haven't received any product reviews yet" : "No reviews match this filter"}
          </p>
        )}
        {page < totalPages ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => load(page + 1)}
            className="mx-auto mt-4 block rounded-full border border-gray-300 bg-white px-5 py-2 text-xs font-semibold text-gray-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </div>
  )
}
