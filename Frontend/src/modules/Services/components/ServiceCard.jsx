import { Link } from "react-router-dom"
import { Minus, Plus } from "lucide-react"
import { useBasket } from "../context/BasketContext"
import SaveButton from "./SaveButton"
import { Thumb, cx, focusRing, formatMoney, withGst } from "../helpers"

/** Add / quantity stepper for one service. */
export function AddButton({ service, category, className }) {
  const basket = useBasket()
  const qty = basket.qtyOf(service.id)
  if (!qty) {
    return (
      <button
        type="button"
        onClick={() => basket.setQty(service, category, 1)}
        className={cx(
          "rounded-xl border border-violet-600 bg-white px-5 py-1.5 text-sm font-extrabold text-violet-700 shadow-sm hover:bg-violet-50",
          focusRing,
          className
        )}
      >
        Add
      </button>
    )
  }
  return (
    <div className={cx("flex items-center rounded-xl bg-violet-600 text-white shadow-sm", className)}>
      <button
        type="button"
        onClick={() => basket.setQty(service, category, qty - 1)}
        className={cx("rounded-l-xl p-2", focusRing)}
        aria-label={`Remove one ${service.title}`}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-6 text-center text-sm font-extrabold" aria-live="polite">{qty}</span>
      <button
        type="button"
        onClick={() => basket.setQty(service, category, Math.min(qty + 1, 10))}
        className={cx("rounded-r-xl p-2", focusRing)}
        aria-label={`Add one more ${service.title}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * One service in a list. `category` is the category it is booked under, which
 * the basket needs to keep one booking to one kind of professional.
 */
export default function ServiceCard({ service, category }) {
  return (
    <article className="flex gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {service.brandName ? (
              <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">{service.brandName}</p>
            ) : null}
            <Link to={`/services/service/${service.id}`} className={cx("rounded", focusRing)}>
              <h3 className="mt-0.5 text-[15px] font-extrabold leading-snug text-gray-900 hover:underline">{service.title}</h3>
            </Link>
          </div>
          <SaveButton service={service} className="-mr-1 -mt-1 shrink-0" size="h-4 w-4" />
        </div>
        <p className="mt-1 text-sm font-bold text-gray-900">
          {formatMoney(service.basePrice)}
          {service.pricingUnit ? <span className="font-medium text-gray-500"> / {service.pricingUnit}</span> : null}
        </p>
        <p className="text-[11px] text-gray-500">
          {formatMoney(withGst(service.basePrice, service.gstPercentage))} incl. GST
        </p>
        {service.description ? <p className="mt-2 line-clamp-2 text-xs text-gray-600">{service.description}</p> : null}
        <Link
          to={`/services/service/${service.id}`}
          className={cx("mt-2 inline-block rounded text-xs font-bold text-violet-700 hover:underline", focusRing)}
        >
          View details
        </Link>
      </div>
      <div className="flex w-24 shrink-0 flex-col items-center">
        <Thumb src={service.icon || service.brandIcon} name={service.title} className="h-24 w-24 rounded-xl" />
        <AddButton service={service} category={category} className="-mt-4" />
      </div>
    </article>
  )
}
