/**
 * The heart on a product or a store. Signed out, it takes the customer to the
 * platform sign-in and brings them back to the page they were on.
 */
import { Heart } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuickFavorites } from "../context/QuickFavoritesContext"
import { cx, focusRing } from "../helpers"

export default function FavoriteButton({ kind, id, name = "", className = "", size = "h-4 w-4" }) {
  const { isFavorite, toggle } = useQuickFavorites()
  const navigate = useNavigate()
  const location = useLocation()
  const on = isFavorite(kind, id)
  const what = name || (kind === "store" ? "this store" : "this product")

  const click = async (e) => {
    // Cards are links underneath; the heart must not open them.
    e.preventDefault()
    e.stopPropagation()
    const done = await toggle(kind, id)
    if (!done) navigate("/login", { state: { from: { pathname: location.pathname, search: location.search } } })
  }

  return (
    <button type="button" onClick={click} aria-pressed={on} aria-label={on ? `Remove ${what} from favourites` : `Save ${what} to favourites`}
      className={cx("flex items-center justify-center rounded-full bg-white/90 p-1.5 shadow-sm hover:bg-white", focusRing, className)}>
      <Heart className={cx(size, on ? "fill-[#E11D48] text-[#E11D48]" : "text-wh-muted")} aria-hidden="true" />
    </button>
  )
}
