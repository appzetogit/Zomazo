import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Clock, Heart, MapPin, Star } from "lucide-react"
import { catalogAPI, searchAPI, sellerAPI } from "@/services/api"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useProfile } from "@store/context/ProfileContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { mediaUrl } from "../desktop/desktopCart"
import { useQuickEta } from "../desktop/useDeliveryEstimates"
import MobileTopBar from "./MobileTopBar"

/**
 * "Stores Near You" from the mobile mockup (screen 8): nearest first when the
 * address is known, filterable by what the stores sell, each row with its
 * rating, distance, delivery time and categories.
 */

export default function MobileStoresList() {
  const { isQuick, storePath, fulfilmentMode } = useStoreMode()
  const { effectiveLocation, zoneId } = useDeliveryLocation()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  const eta = useQuickEta()
  const [stores, setStores] = useState([])
  const [soldBy, setSoldBy] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("All")

  const lat = effectiveLocation?.latitude
  const lng = effectiveLocation?.longitude
  const place = effectiveLocation?.city || effectiveLocation?.area || "you"

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const near = Number.isFinite(lat) && Number.isFinite(lng)
    Promise.all([
      (near
        ? catalogAPI.getNearbyStores({ lat, lng, limit: 50, ...(isQuick ? { fulfilmentMode: "quick" } : {}) })
        : sellerAPI.getSellers({ limit: 50 })
      ).then((r) => {
        const d = r?.data?.data
        return d?.stores || d?.sellers || (Array.isArray(d) ? d : [])
      }),
      // What each store sells, for the chips and the tags on each row. Search
      // pages hold at most 50, so read them all (up to 6).
      (async () => {
        const params = { limit: 50, fulfilmentMode, ...(isQuick && zoneId ? { zoneId } : {}) }
        const all = []
        for (let page = 1; page <= 6; page++) {
          const d = await searchAPI
            .searchProducts({ ...params, page })
            .then((r) => r?.data?.data || {})
            .catch(() => ({}))
          const batch = d.products || []
          all.push(...batch)
          if (batch.length < 50 || all.length >= Number(d.total || 0)) break
        }
        return all
      })(),
    ])
      .then(([list, products]) => {
        if (cancelled) return
        const map = {}
        for (const p of products) {
          const sid = String(p.sellerId || p.seller?._id || "")
          if (!sid || !p.categoryName) continue
          map[sid] = map[sid] || new Map()
          map[sid].set(p.categoryName, (map[sid].get(p.categoryName) || 0) + 1)
        }
        const tags = {}
        for (const [sid, counts] of Object.entries(map)) {
          tags[sid] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
        }
        setSoldBy(tags)
        setStores(list.map((s) => ({ ...s, sellerName: s.sellerName || s.name })))
      })
      .catch(() => !cancelled && setStores([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [lat, lng, isQuick, fulfilmentMode, zoneId])

  const chips = useMemo(() => {
    const count = new Map()
    for (const list of Object.values(soldBy)) for (const name of list) count.set(name, (count.get(name) || 0) + 1)
    return ["All", ...[...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 8)]
  }, [soldBy])

  // Only stores with something to sell in this mode; an empty store is a dead end.
  const selling = stores.filter((s) => (soldBy[String(s._id)] || []).length > 0)
  const shown = filter === "All" ? selling : selling.filter((s) => (soldBy[String(s._id)] || []).includes(filter))

  return (
    <div className="min-h-screen bg-[#F7F7F8] pb-6 lg:hidden">
      <MobileTopBar
        title="Stores Near You"
        subtitle={loading ? "Finding stores…" : `${selling.length} store${selling.length === 1 ? "" : "s"} delivering to ${place}`}
        actions={["search"]}
      />
      <div className="sticky top-14 z-30 flex gap-2 overflow-x-auto border-b border-gray-100 bg-white px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold ${
              filter === c ? "bg-[#EA580C] text-white" : "bg-gray-100 text-gray-700"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="space-y-2.5 px-3 pt-3">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3 rounded-2xl bg-white p-3">
                <div className="h-14 w-14 animate-pulse rounded-full bg-gray-200/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200/80" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200/80" />
                </div>
              </div>
            ))
          : shown.map((s) => {
              const slug = s.slug || s._id
              const liked = isFavorite(slug)
              const tags = (soldBy[String(s._id)] || []).slice(0, 3)
              const km = Number(s.distanceKm)
              return (
                <Link
                  key={s._id}
                  to={storePath(`/sellers/${slug}`)}
                  className="wh-reveal is-visible flex gap-3 rounded-2xl bg-white p-3 shadow-[0_1px_4px_rgba(0,0,0,0.05)] active:scale-[0.99]"
                >
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-gray-100 bg-gray-50">
                    {s.profileImage ? <img src={mediaUrl(s.profileImage)} alt="" className="h-full w-full object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="truncate text-[15px] font-bold text-gray-900">{s.sellerName}</span>
                      <button
                        type="button"
                        aria-label={liked ? "Unsave store" : "Save store"}
                        aria-pressed={liked}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (liked) removeFavorite(slug)
                          else addFavorite({ slug, id: s._id, name: s.sellerName, image: mediaUrl(s.profileImage) })
                        }}
                        className="-mr-1 -mt-1 shrink-0 p-1"
                      >
                        <Heart className={`h-5 w-5 ${liked ? "fill-[#E4322B] text-[#E4322B]" : "text-gray-400"}`} aria-hidden="true" />
                      </button>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-gray-600">
                      {Number(s.rating) > 0 ? (
                        <span className="flex items-center gap-0.5 font-semibold text-gray-800">
                          <Star className="h-3 w-3 fill-[#1E9E48] text-[#1E9E48]" aria-hidden="true" />
                          {Number(s.rating).toFixed(1)}
                        </span>
                      ) : null}
                      {Number.isFinite(km) ? (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" aria-hidden="true" /> {km.toFixed(1)} km
                        </span>
                      ) : s.location?.area ? (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" aria-hidden="true" /> {s.location.area}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3" aria-hidden="true" /> {isQuick ? `${eta} min` : "2-4 days"}
                      </span>
                    </span>
                    {tags.length ? (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span key={t} className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {s.isAcceptingOrders === false ? (
                      <span className="mt-1.5 block text-[11px] font-semibold text-[#CC0C39]">Not taking orders right now</span>
                    ) : null}
                  </span>
                </Link>
              )
            })}
        {!loading && !shown.length ? (
          <p className="rounded-2xl bg-white p-8 text-center text-[14px] text-gray-500">No stores deliver here yet.</p>
        ) : null}
      </div>
    </div>
  )
}
