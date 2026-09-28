import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { quickAPI, errorMessage } from "../api"
import { isSignedIn } from "../helpers"

/**
 * The customer's favourite stores and products (/qc/user/favorites).
 *
 * Loaded once for the app so every heart knows its state; a tap flips the
 * heart at once and puts it back if the server refuses. The server treats a
 * repeated add or remove as success, so a double tap cannot desync it.
 */
const QuickFavoritesContext = createContext(null)

const emptyIds = { store: new Set(), product: new Set() }

export function QuickFavoritesProvider({ children }) {
  const [ids, setIds] = useState(emptyIds)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!isSignedIn()) return undefined
    let cancelled = false
    quickAPI
      .favorites()
      .then((d) => {
        if (cancelled) return
        setIds({ store: new Set((d.restaurantIds || []).map(String)), product: new Set((d.foodIds || []).map(String)) })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const flip = (kind, id, on) =>
    setIds((prev) => {
      const next = new Set(prev[kind])
      if (on) next.add(id)
      else next.delete(id)
      return { ...prev, [kind]: next }
    })

  const isFavorite = useCallback((kind, id) => ids[kind]?.has(String(id)) || false, [ids])

  /** @returns false when the customer must sign in first */
  const toggle = useCallback(
    async (kind, rawId) => {
      const id = String(rawId || "")
      if (!id) return true
      if (!isSignedIn()) return false
      const on = !ids[kind].has(id)
      flip(kind, id, on)
      try {
        await quickAPI.setFavorite(kind, id, on)
        setVersion((v) => v + 1)
        toast.success(on ? "Saved to your favourites" : "Removed from your favourites")
      } catch (err) {
        flip(kind, id, !on)
        toast.error(errorMessage(err, "Your favourites could not be updated."))
      }
      return true
    },
    [ids],
  )

  const value = useMemo(() => ({ isFavorite, toggle, version }), [isFavorite, toggle, version])
  return <QuickFavoritesContext.Provider value={value}>{children}</QuickFavoritesContext.Provider>
}

export const useQuickFavorites = () => {
  const ctx = useContext(QuickFavoritesContext)
  if (!ctx) throw new Error("useQuickFavorites must be used inside QuickFavoritesProvider")
  return ctx
}
