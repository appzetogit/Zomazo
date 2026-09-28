import { useEffect } from "react"
import { Link } from "react-router-dom"
import { servicesAPI } from "../api"
import { useCatalogIndex, useLoad } from "../hooks"
import { useFavourites } from "../context/FavouritesContext"
import ServiceCard from "../components/ServiceCard"
import { EmptyState, Skeleton, isSignedIn, useRequireLogin } from "../helpers"

/** Saved services: the customer's shortlist to book again. */
export default function Saved() {
  const requireLogin = useRequireLogin()
  const signedIn = isSignedIn()
  useEffect(() => {
    requireLogin()
  }, [requireLogin])

  const list = useLoad(() => (signedIn ? servicesAPI.favourites() : Promise.resolve({ data: [] })), [signedIn])
  const fav = useFavourites()
  const index = useCatalogIndex()

  if (!signedIn) return null
  // Un-saving from a card here takes it off the list at once.
  const services = (list.data?.data || []).filter((s) => !fav.ready || fav.isSaved(s.id))

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-4">
      <h1 className="text-xl font-extrabold text-gray-900">Saved services</h1>
      <div className="mt-4">
        {list.loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, n) => (
              <Skeleton key={n} className="h-36" />
            ))}
          </div>
        ) : list.error ? (
          <EmptyState
            title="Could not load your saved services"
            text={list.error}
            action={
              <button type="button" onClick={() => list.reload()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
                Try again
              </button>
            }
          />
        ) : services.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} category={index.categoryOf(s)} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing saved yet"
            text="Tap the heart on any service to keep it here for next time."
            action={
              <Link to="/services" className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">
                Browse services
              </Link>
            }
          />
        )}
      </div>
    </div>
  )
}
