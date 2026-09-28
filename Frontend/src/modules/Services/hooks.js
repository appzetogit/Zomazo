import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { servicesAPI, errorMessage } from "./api"

/**
 * Load something once per `deps` change, with loading / error / reload.
 * Stale responses (the customer moved on before it came back) are dropped.
 */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: "" })
  const seq = useRef(0)
  // The caller names what the loader depends on, as with useEffect.
  const run = useCallback(loader, deps)

  const reload = useCallback(
    (quiet = false) => {
      const mine = ++seq.current
      if (!quiet) setState((s) => ({ ...s, loading: true, error: "" }))
      return Promise.resolve()
        .then(run)
        .then((data) => {
          if (mine === seq.current) setState({ data, loading: false, error: "" })
        })
        .catch((err) => {
          if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err) }))
        })
    },
    [run]
  )

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}

/*
 * Categories and brands, fetched once per visit. A service carries a
 * categoryId only when an admin set one; otherwise it belongs to its brand's
 * category. The basket and the booking need the category either way, so
 * screens that list services from several categories (home, search) resolve
 * it through this index.
 */
let indexPromise = null
const loadIndex = () => {
  if (!indexPromise) {
    indexPromise = Promise.all([servicesAPI.categories(), servicesAPI.brands()]).catch((err) => {
      indexPromise = null
      throw err
    })
  }
  return indexPromise
}

export function useCatalogIndex() {
  const [index, setIndex] = useState({ categories: [], brands: [] })
  useEffect(() => {
    let live = true
    loadIndex()
      .then(([categories, brands]) => live && setIndex({ categories, brands }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return useMemo(() => {
    const byId = new Map(index.categories.map((c) => [String(c.id), c]))
    const brandCategory = new Map(index.brands.map((b) => [String(b.id), String(b.categoryId || "")]))
    const categoryOf = (service) =>
      byId.get(String(service?.categoryId || "")) || byId.get(brandCategory.get(String(service?.brandId || "")) || "") || null
    return { categories: index.categories, categoryById: (id) => byId.get(String(id)) || null, categoryOf }
  }, [index])
}
