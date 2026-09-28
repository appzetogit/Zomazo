import { Link, useParams } from "react-router-dom"
import { BadgeCheck, BriefcaseBusiness, CalendarDays, MapPin, Star } from "lucide-react"
import { servicesAPI } from "../api"
import { useCatalogIndex, useLoad } from "../hooks"
import ServiceCard from "../components/ServiceCard"
import { EmptyState, Skeleton, Stars, Thumb, cx, focusRing, formatDate } from "../helpers"

/** "3 years", "8 months", "New" -- how long someone has worked on the platform. */
function tenure(since) {
  const start = since ? new Date(since) : null
  if (!start || Number.isNaN(start.getTime())) return null
  const months = Math.floor((Date.now() - start.getTime()) / (30.44 * 86400000))
  if (months >= 12) {
    const years = Math.floor(months / 12)
    return `${years} year${years > 1 ? "s" : ""}`
  }
  if (months >= 1) return `${months} month${months > 1 ? "s" : ""}`
  return "New"
}

function Fact({ icon: Icon, value, label }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-xl bg-gray-50 p-3 text-center">
      <Icon className="h-4 w-4 text-violet-600" aria-hidden="true" />
      <p className="mt-1 text-base font-extrabold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  )
}

/**
 * A professional's public profile, from the Professionals tab. Who they are,
 * how customers rate them, what they do and how long they have been with us.
 * Bookings still go to the nearest free professional, so this is not a way to
 * book this one -- the page says so.
 */
export default function ProviderProfile() {
  const { providerId } = useParams()
  const detail = useLoad(() => servicesAPI.provider(providerId), [providerId])
  const index = useCatalogIndex()

  if (detail.loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Skeleton className="h-36" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  const p = detail.data?.provider
  if (!p) {
    return (
      <EmptyState
        title="This professional is not available"
        text={detail.error}
        action={
          <Link to="/services" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
            Browse services
          </Link>
        }
      />
    )
  }

  const rating = detail.data.rating || {}
  const reviews = detail.data.reviews || []
  const services = detail.data.services || []
  const since = tenure(p.memberSince)

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pb-24 pt-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-4">
          <Thumb src={p.photo} name={p.name} className="h-20 w-20 shrink-0 rounded-full" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 text-xl font-extrabold text-gray-900">
              <span className="truncate">{p.name}</span>
              <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Verified" />
            </h1>
            {rating.total ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-700">
                <Stars value={rating.average} size={13} />
                <span className="font-bold">{Number(rating.average).toFixed(1)}</span>
                <span className="text-gray-500">({rating.total} reviews)</span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-gray-500">No reviews yet</p>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
              {p.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" aria-hidden="true" /> {p.city}
                </span>
              ) : null}
              {p.isOnline ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">Online now</span> : null}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Fact icon={BriefcaseBusiness} value={p.completedJobs} label="Jobs done" />
          <Fact icon={Star} value={rating.total ? Number(rating.average).toFixed(1) : "New"} label="Rating" />
          <Fact icon={CalendarDays} value={since || "New"} label={since && since !== "New" ? "With us" : "On the platform"} />
        </div>
        {p.skills?.length ? (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Skills">
            {p.skills.map((s) => (
              <li key={s} className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700">
                {s}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
          Bookings go to the nearest available professional, so you cannot pick who comes. Everyone who works here is
          verified.
        </p>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="text-base font-extrabold text-gray-900">Ratings and reviews</h2>
        {rating.total ? (
          <div className="mt-3 space-y-1">
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
        ) : null}
        {reviews.length ? (
          <ul className="mt-4 divide-y divide-gray-100">
            {reviews.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-gray-900">{r.author}</p>
                  <p className="shrink-0 text-xs text-gray-400">{formatDate(r.createdAt)}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <Stars value={r.rating} size={12} />
                  {r.service ? <span className="truncate text-[11px] text-gray-500">{r.service}</span> : null}
                </div>
                {r.review ? <p className="mt-1.5 text-sm text-gray-700">{r.review}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No written reviews yet.</p>
        )}
      </section>

      {services.length ? (
        <section>
          <h2 className="mb-3 text-base font-extrabold text-gray-900">Services in {p.categories?.map((c) => c.title).join(", ") || "their line of work"}</h2>
          <div className="grid gap-3">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} category={index.categoryOf(s)} />
            ))}
          </div>
        </section>
      ) : p.categories?.length ? (
        <section className="flex flex-wrap gap-2">
          {p.categories.map((c) => (
            <Link key={c.id} to={`/services/category/${c.id}`} className={cx("rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-violet-700", focusRing)}>
              {c.title}
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  )
}
