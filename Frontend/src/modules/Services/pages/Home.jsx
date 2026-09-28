import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CalendarClock, ShieldCheck, Star } from "lucide-react"
import { servicesAPI } from "../api"
import { useCatalogIndex, useLoad } from "../hooks"
import ServiceCard from "../components/ServiceCard"
import { EmptyState, Skeleton, Thumb, cx, focusRing, formatMoney, mediaUrl } from "../helpers"

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)

/** Where a home-content card leads: its target category, if it has one. */
const targetOf = (item) => (item?.targetCategoryId ? `/services/category/${item.targetCategoryId}` : null)

function MaybeLink({ to, className, children }) {
  if (!to) return <div className={className}>{children}</div>
  return (
    <Link to={to} className={cx(className, focusRing)}>
      {children}
    </Link>
  )
}

function Banners({ banners }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (banners.length < 2) return undefined
    const t = setInterval(() => setI((n) => (n + 1) % banners.length), 5000)
    return () => clearInterval(t)
  }, [banners.length])
  if (!banners.length) return null
  const b = banners[i % banners.length]
  return (
    <section aria-label="Offers" className="px-4">
      <MaybeLink to={targetOf(b)} className="block overflow-hidden rounded-2xl bg-violet-100">
        <img src={mediaUrl(b.imageUrl)} alt="" className="aspect-[21/9] w-full object-cover" />
      </MaybeLink>
      {banners.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5">
          {banners.map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Show offer ${n + 1}`}
              className={cx("h-1.5 rounded-full", n === i % banners.length ? "w-5 bg-violet-600" : "w-1.5 bg-gray-300")}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Rail({ title, children, to }) {
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center justify-between px-4">
        <h2 className="text-lg font-extrabold text-gray-900">{title}</h2>
        {to ? (
          <Link to={to} className={cx("rounded text-sm font-bold text-violet-700", focusRing)}>
            See all
          </Link>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1">{children}</div>
    </section>
  )
}

function ImageCard({ item }) {
  return (
    <MaybeLink to={targetOf(item)} className="w-40 shrink-0 rounded-2xl">
      <Thumb src={item.imageUrl} name={item.title} className="aspect-[4/5] w-40 rounded-2xl" />
      <p className="mt-2 line-clamp-2 text-sm font-bold text-gray-900">{item.title}</p>
      {item.rating || item.price ? (
        <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-600">
          {item.rating ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-gray-700 text-gray-700" aria-hidden="true" /> {item.rating}
            </span>
          ) : null}
          {item.price ? <span className="font-bold text-gray-900">{formatMoney(item.price)}</span> : null}
        </p>
      ) : null}
    </MaybeLink>
  )
}

export default function Home() {
  const home = useLoad(() => servicesAPI.homeData(), [])
  const popular = useLoad(() => servicesAPI.services(), [])
  const index = useCatalogIndex()

  const categories = useMemo(() => (home.data?.categories || []).filter((c) => c.showOnHome !== false), [home.data])
  const content = home.data?.homeContent || null
  const visible = (key) => content && content[key] !== false

  if (home.loading && !home.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-5 p-4">
        <Skeleton className="aspect-[21/9] w-full" />
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {Array.from({ length: 8 }, (_, n) => (
            <Skeleton key={n} className="aspect-square" />
          ))}
        </div>
      </div>
    )
  }

  if (home.error && !home.data) {
    return (
      <EmptyState
        title="Services could not load"
        text={home.error}
        action={
          <button type="button" onClick={() => home.reload()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
            Try again
          </button>
        }
      />
    )
  }

  const popularServices = (popular.data || []).slice(0, 8)

  return (
    <div className="mx-auto max-w-5xl pt-4">
      <div className="px-4">
        <h1 className="text-2xl font-extrabold text-gray-900">Home services, at your door</h1>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Verified professionals
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-4 w-4 text-violet-600" aria-hidden="true" /> Pick your time
          </span>
        </p>
      </div>

      {visible("isCategoriesVisible") || !content ? (
        <section aria-labelledby="svc-cats" className="mt-5 px-4">
          <h2 id="svc-cats" className="sr-only">Categories</h2>
          {categories.length ? (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
              {categories.map((c) => (
                <Link key={c.id} to={`/services/category/${c.id}`} className={cx("group flex flex-col items-center rounded-xl text-center", focusRing)}>
                  <span className="relative block aspect-square w-full overflow-hidden rounded-2xl bg-violet-50 p-3 group-hover:bg-violet-100">
                    {c.icon ? (
                      <img src={mediaUrl(c.icon)} alt="" className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-xl font-extrabold text-violet-400">{c.title?.charAt(0)}</span>
                    )}
                    {c.badge ? (
                      <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 text-[9px] font-bold text-white">{c.badge}</span>
                    ) : null}
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-[11px] font-bold leading-tight text-gray-800">{c.title}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No services are offered here yet.</p>
          )}
        </section>
      ) : null}

      {visible("isBannersVisible") ? (
        <div className="mt-6">
          <Banners banners={[...(content.banners || [])].filter((b) => b.imageUrl).sort(byOrder)} />
        </div>
      ) : null}

      {visible("isPromosVisible") && content.promos?.length ? (
        <Rail title="Offers for you">
          {[...content.promos].sort(byOrder).map((p, n) => (
            <MaybeLink key={n} to={targetOf(p)} className="relative w-72 shrink-0 overflow-hidden rounded-2xl bg-gray-900">
              {p.imageUrl ? <img src={mediaUrl(p.imageUrl)} alt="" className="aspect-[16/9] w-full object-cover opacity-80" /> : <div className="aspect-[16/9]" />}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 p-3 text-white">
                <p className="text-sm font-extrabold">{p.title}</p>
                {p.subtitle ? <p className="text-xs text-gray-200">{p.subtitle}</p> : null}
              </div>
            </MaybeLink>
          ))}
        </Rail>
      ) : null}

      {popularServices.length ? (
        <section className="mt-7 px-4">
          <h2 className="mb-3 text-lg font-extrabold text-gray-900">Popular services</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {popularServices.map((s) => (
              <ServiceCard key={s.id} service={s} category={index.categoryOf(s)} />
            ))}
          </div>
        </section>
      ) : null}

      {visible("isBookedVisible") && content.booked?.length ? (
        <Rail title="Most booked">
          {[...content.booked].sort(byOrder).map((item, n) => (
            <ImageCard key={n} item={item} />
          ))}
        </Rail>
      ) : null}

      {visible("isNoteworthyVisible") && content.noteworthy?.length ? (
        <Rail title="New and noteworthy">
          {[...content.noteworthy].sort(byOrder).map((item, n) => (
            <ImageCard key={n} item={item} />
          ))}
        </Rail>
      ) : null}

      {visible("isCategorySectionsVisible")
        ? [...(content.categorySections || [])].sort(byOrder).map((section, n) =>
            section.cards?.length ? (
              <Rail
                key={n}
                title={section.title}
                to={section.seeAllTargetCategoryId ? `/services/category/${section.seeAllTargetCategoryId}` : null}
              >
                {section.cards.map((card, m) => (
                  <ImageCard key={m} item={card} />
                ))}
              </Rail>
            ) : null
          )
        : null}
      <div className="h-8" />
    </div>
  )
}
