/**
 * A store in a list: logo, name, rating, delivery time, distance and whether
 * it is open, with its favourite heart. `wide` fills its row (the stores page
 * and favourites); otherwise it is a fixed-width card for a scroller.
 */
import { Link } from "react-router-dom"
import { Star } from "lucide-react"
import FavoriteButton from "./FavoriteButton"
import { cx, focusRing, isRealImage, mediaUrl } from "../helpers"

export const storeId = (s) => String(s?._id || s?.id || "")
export const storeTitle = (s) => s?.restaurantName || s?.name || "Store"
export const storeEta = (s) => Number(s?.estimatedDeliveryTimeMinutes) || null
export const storeClosed = (s) => s?.isOpenNow === false || s?.isAcceptingOrders === false

export default function StoreCard({ store, wide = false }) {
  const id = storeId(store)
  const name = storeTitle(store)
  const img = mediaUrl(store.profileImage?.url || store.profileImage || store.coverImages?.[0])
  const eta = storeEta(store)
  const km = Number(store.distanceInKm)
  const place = [store.area, store.city].filter(Boolean).join(", ")

  return (
    <div className={cx("relative shrink-0", wide ? "w-full" : "w-[240px]")}>
      <Link to={`/quick/store/${id}`}
        className={cx("flex items-center gap-3 rounded-[10px] border border-wh-border bg-white p-3 pr-11 hover:shadow-md", storeClosed(store) && "opacity-70", focusRing)}>
        <span className={cx("flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-wh-brand-50", wide ? "h-14 w-14" : "h-12 w-12")}>
          {isRealImage(img) ? <img src={img} alt="" className="h-full w-full object-cover" /> : <span className="font-black text-wh-brand-ink">{name.charAt(0)}</span>}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-wh-text">{name}</span>
          {wide && place ? <span className="block truncate text-[12px] text-wh-muted">{place}</span> : null}
          <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-wh-muted">
            {Number(store.rating) ? <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3 fill-current text-amber-500" aria-hidden="true" />{Number(store.rating).toFixed(1)}</span> : null}
            {eta ? <span>{eta} min</span> : null}
            {Number.isFinite(km) && km > 0 ? <span>{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</span> : null}
            {storeClosed(store) ? <span className="font-semibold text-wh-deal">Closed</span> : null}
          </span>
        </span>
      </Link>
      <FavoriteButton kind="store" id={id} name={name} className="absolute right-2 top-1/2 -translate-y-1/2" />
    </div>
  )
}
