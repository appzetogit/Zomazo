/**
 * Product page reviews: average + star histogram, sort (newest / most
 * helpful), filter by star, the list with photos and seller replies, one
 * "Helpful" vote per customer, and "Write a review" when the server says the
 * signed-in customer received this product. Used by the mobile and desktop pages.
 */
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { BadgeCheck, Flag, Loader2, Store, ThumbsUp } from "lucide-react"
import { toast } from "sonner"
import { catalogAPI, userAPI } from "@store/api"
import { isModuleAuthenticated } from "@store/utils/auth"
import { StarDisplay } from "./StarRating"
import ReviewFormDialog from "./ReviewFormDialog"

const PAGE_SIZE = 10
const dateFmt = (d) => {
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d))
  } catch {
    return ""
  }
}

function Histogram({ histogram, total, activeStar, onPick }) {
  return (
    <ul className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((star) => {
        const n = Number(histogram?.[star]) || 0
        const pct = total ? Math.round((n / total) * 100) : 0
        return (
          <li key={star}>
            <button
              type="button"
              onClick={() => onPick(activeStar === star ? null : star)}
              disabled={!n}
              aria-pressed={activeStar === star}
              className="flex w-full items-center gap-2 rounded text-left text-[13px] text-wh-link hover:text-wh-link-hover disabled:cursor-default disabled:text-gray-500 focus-visible:outline-2 focus-visible:outline-wh-brand"
            >
              <span className="w-12 shrink-0">{star} star</span>
              <span className="h-4 flex-1 overflow-hidden rounded border border-gray-300 bg-gray-100" aria-hidden="true">
                <span className="block h-full bg-wh-brand" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right">{pct}%</span>
              <span className="sr-only">{`${n} review${n === 1 ? "" : "s"}`}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ReviewItem({ review, signedIn, onVote, onReport }) {
  const [busy, setBusy] = useState(false)
  const act = async (fn) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  return (
    <li className="border-b border-gray-200 py-4 last:border-b-0">
      <p className="text-[13px] font-medium text-gray-800">{review.author?.name || "Customer"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <StarDisplay rating={review.rating} />
        {review.title ? <span className="text-[14px] font-bold text-gray-900">{review.title}</span> : null}
      </div>
      <p className="mt-1 text-[12px] text-gray-500">
        Reviewed on {dateFmt(review.createdAt)}
        {review.variantName ? ` · ${review.variantName}` : ""}
        {review.edited ? " · edited" : ""}
      </p>
      <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-wh-brand-ink">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified purchase
      </p>
      {review.text ? <p className="mt-2 whitespace-pre-line text-[14px] leading-5 text-gray-800">{review.text}</p> : null}
      {review.images?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {review.images.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border border-gray-200 focus-visible:outline-2 focus-visible:outline-wh-brand">
              <img src={url} alt={`Photo from ${review.author?.name || "a customer"}`} loading="lazy" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      {review.reply ? (
        <div className="mt-3 rounded-lg border-l-4 border-wh-brand bg-wh-brand-50 px-3 py-2">
          <p className="inline-flex items-center gap-1 text-[12px] font-bold text-gray-800">
            <Store className="h-3.5 w-3.5" aria-hidden="true" /> Response from the seller
          </p>
          <p className="mt-1 whitespace-pre-line text-[13px] text-gray-800">{review.reply.text}</p>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-gray-600">
        {review.helpfulCount > 0 ? <span>{review.helpfulCount} {review.helpfulCount === 1 ? "person" : "people"} found this helpful</span> : null}
        {signedIn && !review.isMine ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => onVote(review))}
              aria-pressed={Boolean(review.votedHelpful)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-medium focus-visible:outline-2 focus-visible:outline-wh-brand ${
                review.votedHelpful ? "border-wh-brand bg-wh-brand-50 text-wh-brand-ink" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              }`}
            >
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" /> Helpful
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => onReport(review))}
              className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800 hover:underline focus-visible:outline-2 focus-visible:outline-wh-brand"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Report
            </button>
          </>
        ) : null}
        {review.isMine ? <span className="font-medium text-wh-brand-ink">Your review</span> : null}
      </div>
    </li>
  )
}

export default function ProductReviews({ productId, productName, variant = "mobile" }) {
  const signedIn = isModuleAuthenticated("user")
  const [data, setData] = useState(null)
  const [reviews, setReviews] = useState([])
  const [sort, setSort] = useState("newest")
  const [star, setStar] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [eligible, setEligible] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(async (nextPage = 1) => {
    if (!productId) return
    setLoading(true)
    try {
      const res = await catalogAPI.getProductReviews(productId, { sort, rating: star || undefined, page: nextPage, limit: PAGE_SIZE })
      const d = res?.data?.data || null
      setData(d)
      setPage(nextPage)
      setReviews((prev) => (nextPage === 1 ? d?.reviews || [] : [...prev, ...(d?.reviews || [])]))
    } catch {
      if (nextPage === 1) setReviews([])
    } finally {
      setLoading(false)
    }
  }, [productId, sort, star])

  useEffect(() => { load(1) }, [load])

  useEffect(() => {
    if (!signedIn || !productId) return
    let cancelled = false
    userAPI.getReviewEligibility(productId)
      .then((res) => { if (!cancelled) setEligible(Boolean(res?.data?.data?.eligible)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [signedIn, productId])

  const onVote = async (review) => {
    try {
      const res = review.votedHelpful ? await userAPI.unmarkReviewHelpful(review.id) : await userAPI.markReviewHelpful(review.id)
      const d = res?.data?.data || {}
      setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, helpfulCount: d.helpfulCount ?? r.helpfulCount, votedHelpful: d.votedHelpful } : r)))
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not record your vote")
    }
  }

  const onReport = async (review) => {
    const reason = window.prompt("Why are you reporting this review?")
    if (!reason || !reason.trim()) return
    try {
      await userAPI.reportProductReview(review.id, reason.trim())
      toast.success("Thanks, our team will take a look")
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not report this review")
    }
  }

  const summary = data?.summary || { averageRating: 0, totalRatings: 0, histogram: {} }
  const total = Number(summary.totalRatings) || 0
  const hasMore = data?.pagination ? page < data.pagination.totalPages : false
  const desktop = variant === "desktop"
  const myReview = data?.myReview

  return (
    <section
      aria-labelledby={`reviews-${productId}`}
      className={desktop ? "border-t border-wh-border py-6" : "rounded-2xl border border-gray-200 bg-white p-4 text-gray-900"}
    >
      <div className={desktop ? "grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10" : "space-y-4"}>
        <div>
          <h2 id={`reviews-${productId}`} className={desktop ? "text-[21px] font-bold" : "text-base font-bold"}>Customer reviews</h2>
          <div className="mt-2 flex items-center gap-2">
            <StarDisplay rating={summary.averageRating} size="h-5 w-5" />
            <span className="text-[15px] font-medium">{total ? `${Number(summary.averageRating).toFixed(1)} out of 5` : "No ratings yet"}</span>
          </div>
          <p className="mt-1 text-[13px] text-gray-600">{total} global rating{total === 1 ? "" : "s"}</p>
          {total > 0 ? <div className="mt-3"><Histogram histogram={summary.histogram} total={total} activeStar={star} onPick={setStar} /></div> : null}

          {signedIn && (eligible || myReview) ? (
            <div className="mt-5 border-t border-gray-200 pt-4">
              <p className="text-[15px] font-bold">{myReview ? "Your review" : "Review this product"}</p>
              <p className="mt-1 text-[13px] text-gray-600">{myReview ? "You can update it any time." : "Share your thoughts with other customers."}</p>
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-full border border-gray-300 bg-white text-[13px] font-medium text-gray-900 shadow-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-wh-brand"
              >
                {myReview ? "Edit your review" : "Write a review"}
              </button>
            </div>
          ) : !signedIn ? (
            <p className="mt-4 text-[13px] text-gray-600">
              <Link to="/auth/login" className="text-wh-link hover:text-wh-link-hover hover:underline">Sign in</Link> to review products you've received.
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-bold">
              {star ? `${star}-star reviews` : "Top reviews"}
              {star ? (
                <button type="button" onClick={() => setStar(null)} className="ml-2 text-[12px] font-normal text-wh-link hover:underline">Show all</button>
              ) : null}
            </p>
            <label className="inline-flex items-center gap-2 text-[13px]">
              <span className="text-gray-600">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 focus-visible:outline-2 focus-visible:outline-wh-brand"
              >
                <option value="newest">Newest</option>
                <option value="helpful">Most helpful</option>
              </select>
            </label>
          </div>

          {loading && !reviews.length ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-label="Loading reviews" /></div>
          ) : reviews.length ? (
            <ul className="mt-2">
              {reviews.map((r) => <ReviewItem key={r.id} review={r} signedIn={signedIn} onVote={onVote} onReport={onReport} />)}
            </ul>
          ) : (
            <p className="py-6 text-[13px] text-gray-600">{star ? "No reviews with this rating." : "No written reviews yet."}</p>
          )}

          {hasMore ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => load(page + 1)}
              className="mt-3 inline-flex h-9 items-center justify-center rounded-full border border-gray-300 bg-white px-5 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-wh-brand"
            >
              {loading ? "Loading…" : "More reviews"}
            </button>
          ) : null}
        </div>
      </div>

      <ReviewFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        productId={productId}
        productName={productName}
        onSaved={() => load(1)}
      />
    </section>
  )
}
