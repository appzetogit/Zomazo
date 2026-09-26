import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { catalogAPI } from "@/services/api"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"

/**
 * The Quick phone home's layout (QUICK_MOBILE_SPEC.md §3), fetched once per
 * zone and shared: the header draws the theme tabs, the page draws the chosen
 * theme's block, and both have to agree on which one is chosen.
 */

const EMPTY = { themes: [], featured: [], campaigns: [], categoryGroups: [] }

const QuickLayoutContext = createContext({
  layout: EMPTY,
  loading: false,
  activeTheme: null,
  activeSlug: "",
  setActiveSlug: () => {},
})

// One request per zone for the session.
const cache = new Map()

export function QuickLayoutProvider({ children }) {
  const { zoneId } = useDeliveryLocation()
  const key = String(zoneId || "global")
  const [layout, setLayout] = useState(() => cache.get(key) || EMPTY)
  const [loading, setLoading] = useState(() => !cache.has(key))
  const [activeSlug, setActiveSlug] = useState("")

  useEffect(() => {
    let cancelled = false
    if (cache.has(key)) {
      setLayout(cache.get(key))
      setLoading(false)
      return undefined
    }
    setLoading(true)
    catalogAPI
      .getQuickHome(zoneId || undefined)
      .then((res) => {
        const data = res?.data?.data || EMPTY
        const next = {
          themes: Array.isArray(data.themes) ? data.themes : [],
          featured: Array.isArray(data.featured) ? data.featured : [],
          campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
          categoryGroups: Array.isArray(data.categoryGroups) ? data.categoryGroups : [],
        }
        cache.set(key, next)
        if (!cancelled) setLayout(next)
      })
      .catch(() => {
        if (!cancelled) setLayout(EMPTY)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, zoneId])

  const value = useMemo(() => {
    const activeTheme =
      layout.themes.find((t) => t.slug === activeSlug) || layout.themes[0] || null
    return {
      layout,
      loading,
      activeTheme,
      activeSlug: activeTheme?.slug || "",
      setActiveSlug,
    }
  }, [layout, loading, activeSlug])

  return <QuickLayoutContext.Provider value={value}>{children}</QuickLayoutContext.Provider>
}

export function useQuickLayout() {
  return useContext(QuickLayoutContext)
}
