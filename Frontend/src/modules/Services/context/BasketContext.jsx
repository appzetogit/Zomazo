import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { withGst } from "../helpers"

/**
 * The services the customer is about to book.
 *
 * One booking is dispatched to one professional by its category (an AC
 * technician does not come to fix a tap), so the basket holds one category at a
 * time. Adding from another asks first, then starts over. The first line is the
 * booking's main service; every line goes in as a booked item and the server
 * prices the lot from its own catalogue.
 *
 * Kept in the browser, not the SP server cart: it survives a trip through the
 * login page, and needs no account to fill.
 */
const STORAGE_KEY = "services_basket_v1"
const BasketContext = createContext(null)

const read = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
    return parsed && Array.isArray(parsed.items) ? parsed : { category: null, items: [] }
  } catch {
    return { category: null, items: [] }
  }
}

export function BasketProvider({ children }) {
  const [basket, setBasket] = useState(read)
  // A pending add from a different category, waiting on the customer's answer.
  const [conflict, setConflict] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(basket))
    } catch {
      /* private mode: the basket just lives for this visit */
    }
  }, [basket])

  const put = useCallback((service, category, qty) => {
    setBasket((prev) => {
      const sameCategory = prev.category && category && prev.category.id === category.id
      const items = sameCategory || !prev.items.length ? [...prev.items] : []
      const i = items.findIndex((it) => it.id === service.id)
      if (qty <= 0) {
        if (i >= 0) items.splice(i, 1)
      } else if (i >= 0) {
        items[i] = { ...items[i], qty }
      } else {
        items.push({
          id: service.id,
          title: service.title,
          price: Number(service.basePrice) || 0,
          gst: service.gstPercentage ?? 18,
          icon: service.icon || "",
          pricingUnit: service.pricingUnit || "",
          brandId: service.brandId ? String(service.brandId) : null,
          brandName: service.brandName || "",
          brandIcon: service.brandIcon || "",
          qty,
        })
      }
      return { category: items.length ? category || prev.category : null, items }
    })
  }, [])

  const setQty = useCallback(
    (service, category, qty) => {
      const current = read()
      if (qty > 0 && current.items.length && current.category && category && current.category.id !== category.id) {
        setConflict({ service, category, qty })
        return false
      }
      put(service, category, qty)
      return true
    },
    [put]
  )

  const resolveConflict = useCallback(
    (replace) => {
      if (replace && conflict) {
        setBasket({ category: null, items: [] })
        put(conflict.service, conflict.category, conflict.qty)
      }
      setConflict(null)
    },
    [conflict, put]
  )

  const clear = useCallback(() => setBasket({ category: null, items: [] }), [])

  const value = useMemo(() => {
    const subtotal = basket.items.reduce((s, it) => s + it.price * it.qty, 0)
    const tax = basket.items.reduce((s, it) => s + (withGst(it.price, it.gst) - it.price) * it.qty, 0)
    return {
      category: basket.category,
      items: basket.items,
      count: basket.items.reduce((s, it) => s + it.qty, 0),
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      qtyOf: (id) => basket.items.find((it) => it.id === id)?.qty || 0,
      setQty,
      clear,
      conflict,
      resolveConflict,
    }
  }, [basket, setQty, clear, conflict, resolveConflict])

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>
}

export const useBasket = () => useContext(BasketContext)
