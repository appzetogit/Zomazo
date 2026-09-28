import { useLocation, useNavigate } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { useBasket } from "../context/BasketContext"
import { cx, focusRing, formatMoney } from "../helpers"

/** The strip along the bottom that leads to checkout while the basket has something. */
export function BasketBar() {
  const basket = useBasket()
  const navigate = useNavigate()
  const location = useLocation()
  const hidden =
    !basket.count ||
    location.pathname.startsWith("/services/checkout") ||
    location.pathname.startsWith("/services/bookings")
  if (hidden) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4">
      <button
        type="button"
        onClick={() => navigate("/services/checkout")}
        className={cx(
          "mx-auto flex w-full max-w-5xl items-center justify-between rounded-2xl bg-violet-600 px-5 py-3.5 text-left text-white shadow-lg hover:bg-violet-700",
          focusRing
        )}
      >
        <span>
          <span className="block text-xs font-semibold text-violet-100">
            {basket.count} {basket.count === 1 ? "service" : "services"}
            {basket.category?.title ? ` in ${basket.category.title}` : ""}
          </span>
          <span className="text-base font-extrabold">{formatMoney(basket.subtotal)} + GST</span>
        </span>
        <span className="flex items-center gap-1 text-sm font-extrabold">
          Book now <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
    </div>
  )
}

/** Asked when a service from another category is added to a non-empty basket. */
export function ReplaceBasketDialog() {
  const basket = useBasket()
  if (!basket.conflict) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="replace-basket-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="replace-basket-title" className="text-base font-extrabold text-gray-900">Start a new booking?</h2>
        <p className="mt-2 text-sm text-gray-600">
          Your basket has {basket.category?.title || "another category"} services. One booking covers one kind of
          work, so adding {basket.conflict.category?.title || "this"} will clear it.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => basket.resolveConflict(false)}
            className={cx("flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-gray-700", focusRing)}
          >
            Keep basket
          </button>
          <button
            type="button"
            onClick={() => basket.resolveConflict(true)}
            className={cx("flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white", focusRing)}
          >
            Start new
          </button>
        </div>
      </div>
    </div>
  )
}
