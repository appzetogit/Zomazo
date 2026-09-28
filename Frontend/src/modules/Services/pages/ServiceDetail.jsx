import { Link, useNavigate, useParams } from "react-router-dom"
import { CalendarClock, ShieldCheck, Star } from "lucide-react"
import { servicesAPI } from "../api"
import { useLoad } from "../hooks"
import { useBasket } from "../context/BasketContext"
import ServiceCard, { AddButton } from "../components/ServiceCard"
import { EmptyState, Skeleton, Stars, Thumb, cx, focusRing, formatDate, formatMoney, withGst } from "../helpers"

function RatingSummary({ rating }) {
  if (!rating?.total) {
    return <p className="text-sm text-gray-500">No reviews yet. Be the first to book and rate it.</p>
  }
  return (
    <div className="flex gap-6">
      <div className="text-center">
        <p className="text-4xl font-extrabold text-gray-900">{rating.average.toFixed(1)}</p>
        <Stars value={rating.average} />
        <p className="mt-1 text-xs text-gray-500">{rating.total} reviews</p>
      </div>
      <div className="flex-1 space-y-1">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = rating.distribution?.[n] || 0
          const pct = rating.total ? Math.round((count / rating.total) * 100) : 0
          return (
            <div key={n} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3">{n}</span>
              <Star className="h-3 w-3 fill-gray-400 text-gray-400" aria-hidden="true" />
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span className="block h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-8 text-right">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ServiceDetail() {
  const { serviceId } = useParams()
  const navigate = useNavigate()
  const basket = useBasket()
  const detail = useLoad(() => servicesAPI.service(serviceId), [serviceId])
  const service = detail.data?.service
  const related = useLoad(
    () => (service?.brandId ? servicesAPI.services({ brandId: service.brandId }) : Promise.resolve([])),
    [service?.brandId]
  )

  if (detail.loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (!service) {
    return (
      <EmptyState
        title="This service is not available"
        text={detail.error}
        action={
          <Link to="/services" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
            Browse services
          </Link>
        }
      />
    )
  }

  const category = service.category ? { id: service.category.id, title: service.category.title } : null
  const inBasket = basket.qtyOf(service.id) > 0
  const others = (related.data || []).filter((s) => s.id !== service.id).slice(0, 6)

  return (
    <div className="mx-auto max-w-3xl pb-28">
      <Thumb src={service.icon || service.brandIcon} name={service.title} className="aspect-[16/9] w-full sm:mt-4 sm:rounded-2xl" />
      <div className="px-4">
        <nav className="mt-4 text-xs text-gray-500" aria-label="Breadcrumb">
          <Link to="/services" className="hover:underline">Services</Link>
          {category ? (
            <>
              {" / "}
              <Link to={`/services/category/${category.id}`} className="hover:underline">{category.title}</Link>
            </>
          ) : null}
        </nav>
        {service.brandName ? <p className="mt-2 text-xs font-bold uppercase tracking-wide text-violet-600">{service.brandName}</p> : null}
        <h1 className="mt-1 text-2xl font-extrabold text-gray-900">{service.title}</h1>
        {detail.data.rating?.total ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
            <Stars value={detail.data.rating.average} />
            {detail.data.rating.average.toFixed(1)} ({detail.data.rating.total} reviews)
          </p>
        ) : null}
        <div className="mt-4 flex items-end justify-between gap-4 rounded-2xl bg-violet-50 p-4">
          <div>
            <p className="text-2xl font-extrabold text-gray-900">
              {formatMoney(service.basePrice)}
              {service.pricingUnit ? <span className="text-sm font-medium text-gray-500"> / {service.pricingUnit}</span> : null}
            </p>
            <p className="text-xs text-gray-600">
              {formatMoney(withGst(service.basePrice, service.gstPercentage))} with {service.gstPercentage}% GST. Visiting
              charges apply at checkout.
            </p>
          </div>
          <AddButton service={service} category={category} />
        </div>

        {service.description ? (
          <section className="mt-6">
            <h2 className="text-base font-extrabold text-gray-900">About this service</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">{service.description}</p>
          </section>
        ) : null}

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          <li className="flex gap-3 rounded-2xl border border-gray-100 p-4">
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            <p className="text-sm text-gray-700">Background-verified professionals. Parts, if any are needed, are billed at list price.</p>
          </li>
          <li className="flex gap-3 rounded-2xl border border-gray-100 p-4">
            <CalendarClock className="h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
            <p className="text-sm text-gray-700">Choose a two-hour slot. Reschedule or cancel free until the professional sets out.</p>
          </li>
        </ul>

        <section className="mt-8">
          <h2 className="mb-3 text-base font-extrabold text-gray-900">Ratings and reviews</h2>
          <RatingSummary rating={detail.data.rating} />
          {detail.data.reviews?.length ? (
            <ul className="mt-5 divide-y divide-gray-100">
              {detail.data.reviews.map((r) => (
                <li key={r.id} className="py-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-gray-900">{r.author}</p>
                    <p className="text-xs text-gray-400">{formatDate(r.createdAt)}</p>
                  </div>
                  <Stars value={r.rating} size={12} className="mt-1" />
                  {r.review ? <p className="mt-1.5 text-sm text-gray-700">{r.review}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {others.length ? (
          <section className="mt-8">
            <h2 className="mb-3 text-base font-extrabold text-gray-900">More from {service.brandName || "this brand"}</h2>
            <div className="grid gap-3">
              {others.map((s) => (
                <ServiceCard key={s.id} service={s} category={category} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {!inBasket ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white p-4">
          <button
            type="button"
            onClick={() => {
              // Held back when the basket is another category's: the dialog asks first.
              if (basket.setQty(service, category, 1)) navigate("/services/checkout")
            }}
            className={cx("mx-auto block w-full max-w-3xl rounded-2xl bg-violet-600 py-3.5 text-base font-extrabold text-white hover:bg-violet-700", focusRing)}
          >
            Book this service
          </button>
        </div>
      ) : null}
    </div>
  )
}
