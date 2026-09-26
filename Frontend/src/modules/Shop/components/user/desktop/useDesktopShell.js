import { useEffect, useState } from "react"
import { adminAPI } from "@store/api"
import { getCachedSettings, loadBusinessSettings } from "@store/utils/businessSettings"
import { APP_CONFIG } from "@/config/constants"
import { brandLogoOnDark } from "@/config/brandMark"

/** Business Settings (cached, refreshed on the businessSettingsUpdated event). */
export function useBusinessSettings() {
  const [settings, setSettings] = useState(() => getCachedSettings() || null)
  useEffect(() => {
    let alive = true
    if (!getCachedSettings()) {
      loadBusinessSettings()
        .then((s) => alive && s && setSettings(s))
        .catch(() => {})
    }
    const onUpdate = () => setSettings(getCachedSettings() || null)
    window.addEventListener("businessSettingsUpdated", onUpdate)
    return () => {
      alive = false
      window.removeEventListener("businessSettingsUpdated", onUpdate)
    }
  }, [])
  return {
    settings,
    brandName: settings?.companyName || APP_CONFIG.NAME,
    logoOnDark: brandLogoOnDark(settings || undefined),
  }
}

const categoriesCache = new Map()

/**
 * Public categories (zone-aware), normalised to {id, name, slug, image, parentId}.
 * `tree` groups subcategories under their parent (the API returns parentId and
 * includes parents that hold no products themselves).
 */
export function usePublicCategories(zoneId) {
  const key = String(zoneId || "global")
  const [list, setList] = useState(() => categoriesCache.get(key) || [])
  const [loading, setLoading] = useState(() => !categoriesCache.has(key))
  useEffect(() => {
    let alive = true
    const cached = categoriesCache.get(key)
    if (cached) {
      setList(cached)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    adminAPI
      .getPublicCategories(zoneId ? { zoneId } : {})
      .then((res) => {
        const raw = res?.data?.data?.categories || res?.data?.categories || []
        const items = (Array.isArray(raw) ? raw : []).map((c, i) => ({
          id: String(c?.id || c?._id || c?.slug || i),
          name: c?.name || "",
          slug: c?.slug || String(c?.name || "").toLowerCase().replace(/\s+/g, "-"),
          image: c?.image || c?.imageUrl || "",
          parentId: c?.parentId ? String(c.parentId?._id || c.parentId) : null,
          sortOrder: Number(c?.sortOrder) || 0,
          order: i,
        })).filter((c) => c.name)
          // Parents the API adds for grouping come after the listed ones; put
          // everything back in the admin's sortOrder.
          .sort((a, b) => a.sortOrder - b.sortOrder || a.order - b.order)
        categoriesCache.set(key, items)
        if (alive) {
          setList(items)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!alive) return
        setList([])
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [key, zoneId])

  const byId = new Map(list.map((c) => [c.id, c]))
  const roots = list.filter((c) => !c.parentId || !byId.has(c.parentId))
  const tree = roots.map((r) => ({ ...r, children: list.filter((c) => c.parentId === r.id) }))
  return { categories: list, roots, tree }
}
