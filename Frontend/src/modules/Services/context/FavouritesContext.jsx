import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { servicesAPI, errorMessage } from "../api"
import { isSignedIn, useRequireLogin } from "../helpers"

/**
 * The customer's saved services (/sp/users/favourites), shared by every card
 * and page that shows a heart. Loaded once when signed in; a toggle updates
 * at once and is put back if the server refuses it.
 */
const FavouritesContext = createContext(null)

export function FavouritesProvider({ children }) {
  const signedIn = isSignedIn()
  const [ids, setIds] = useState(() => new Set())
  const [busy, setBusy] = useState(() => new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!signedIn) {
      setIds(new Set())
      return undefined
    }
    let live = true
    servicesAPI
      .favourites()
      .then((res) => {
        if (!live) return
        setIds(new Set((res.ids || []).map(String)))
        setReady(true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [signedIn])

  const requireLogin = useRequireLogin()

  const toggle = useCallback(
    async (service) => {
      if (!requireLogin()) return
      const id = String(service.id)
      if (busy.has(id)) return
      const saved = ids.has(id)
      setBusy((b) => new Set(b).add(id))
      setIds((prev) => {
        const next = new Set(prev)
        if (saved) next.delete(id)
        else next.add(id)
        return next
      })
      try {
        const nextIds = saved ? await servicesAPI.removeFavourite(id) : await servicesAPI.saveFavourite(id)
        setIds(new Set(nextIds.map(String)))
        toast.success(saved ? "Removed from saved" : "Saved. Find it under Saved services.")
      } catch (err) {
        setIds((prev) => {
          const next = new Set(prev)
          if (saved) next.add(id)
          else next.delete(id)
          return next
        })
        toast.error(errorMessage(err, "Could not update your saved services."))
      } finally {
        setBusy((b) => {
          const next = new Set(b)
          next.delete(id)
          return next
        })
      }
    },
    [busy, ids, requireLogin]
  )

  const value = useMemo(
    () => ({ isSaved: (id) => ids.has(String(id)), toggle, count: ids.size, ready }),
    [ids, toggle, ready]
  )
  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}

export const useFavourites = () => useContext(FavouritesContext)
