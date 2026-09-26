/**
 * On a delivered order: one row per product with "Write a review" (or "Edit
 * your review" once written). Renders nothing for orders not yet delivered.
 */
import { useEffect, useMemo, useState } from "react"
import { Star } from "lucide-react"
import { userAPI } from "@store/api"
import { StarDisplay } from "./StarRating"
import ReviewFormDialog from "./ReviewFormDialog"

const isObjectId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ""))

export default function OrderItemsReviewPanel({ order }) {
  const delivered = String(order?.orderStatus || order?.status || "").toLowerCase() === "delivered"
  const products = useMemo(() => {
    const seen = new Map()
    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const id = String(item.itemId || item.productId || "")
      if (isObjectId(id) && !seen.has(id)) seen.set(id, { productId: id, name: item.name || "Item", image: item.image || "" })
    }
    return [...seen.values()]
  }, [order])
  const [mine, setMine] = useState({})
  const [target, setTarget] = useState(null)
  const productKey = products.map((p) => p.productId).join(",")

  useEffect(() => {
    if (!delivered || !productKey) return
    let cancelled = false
    userAPI.getMyProductReviews({ productIds: productKey, limit: 50 })
      .then((res) => {
        if (cancelled) return
        const map = {}
        for (const r of res?.data?.data?.reviews || []) map[String(r.productId)] = r
        setMine(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [delivered, productKey])

  if (!delivered || !products.length) return null

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2">
        <Star className="h-5 w-5 text-wh-brand-ink" aria-hidden="true" />
        <h3 className="font-semibold text-gray-800 dark:text-white">Rate your items</h3>
      </div>
      <ul className="space-y-3">
        {products.map((p) => {
          const review = mine[p.productId]
          return (
            <li key={p.productId} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm font-medium text-gray-700 dark:text-gray-300">{p.name}</p>
                {review ? <StarDisplay rating={review.rating} size="h-3.5 w-3.5" /> : null}
              </div>
              <button
                type="button"
                onClick={() => setTarget(p)}
                className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-wh-brand dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-100"
              >
                {review ? "Edit your review" : "Write a review"}
              </button>
            </li>
          )
        })}
      </ul>
      <ReviewFormDialog
        open={Boolean(target)}
        onOpenChange={(open) => { if (!open) setTarget(null) }}
        productId={target?.productId}
        productName={target?.name}
        onSaved={(review) => {
          if (review && target) setMine((prev) => ({ ...prev, [target.productId]: review }))
        }}
      />
    </div>
  )
}
