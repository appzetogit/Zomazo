import { Heart } from "lucide-react"
import { useFavourites } from "../context/FavouritesContext"
import { cx, focusRing } from "../helpers"

/** The heart that saves a service to the customer's list, or takes it off. */
export default function SaveButton({ service, className, size = "h-5 w-5" }) {
  const fav = useFavourites()
  if (!fav || !service?.id) return null
  const saved = fav.isSaved(service.id)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        fav.toggle(service)
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${service.title} from saved` : `Save ${service.title}`}
      className={cx("rounded-full p-1.5 hover:bg-rose-50", focusRing, className)}
    >
      <Heart className={cx(size, saved ? "fill-rose-500 text-rose-500" : "text-gray-400")} aria-hidden="true" />
    </button>
  )
}
