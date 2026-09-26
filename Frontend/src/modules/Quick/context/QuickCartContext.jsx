import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { productId, productImage, productMaxQty, productMrp, productName, productPack, productPrice, productStore } from "../helpers"

/**
 * The quick-commerce cart: one store at a time.
 *
 * The backend prices and places an order for a single store and rejects items
 * "sold by a different seller", so the cart holds one store's lines. Adding
 * from another store asks first (ReplaceStoreDialog) instead of failing at
 * checkout. Kept in localStorage so it survives a reload; the server re-prices
 * everything at checkout, so a stored price is only ever a preview.
 */
const QuickCartContext = createContext(null)
const STORAGE_KEY = "qc_cart_v2"

const empty = { storeId: "", storeName: "", lines: [] }

const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
    return raw && Array.isArray(raw.lines) ? raw : empty
  } catch {
    return empty
  }
}

// `key` is what the card knows the line by; `itemId` / `variantId` are what the
// order needs. They differ only for a variant, which a store page shows as its
// own card (see StorePage's expandVariants).
const lineFrom = (product, store) => ({
  key: productId(product),
  itemId: String(product.itemId || productId(product)),
  variantId: product.variantId || null,
  variantName: product.variantName || "",
  name: productName(product),
  price: productPrice(product),
  mrp: productMrp(product),
  image: productImage(product),
  pack: productPack(product),
  maxQty: productMaxQty(product),
  quantity: 1,
  storeId: store.id,
})

export function QuickCartProvider({ children }) {
  const [cart, setCart] = useState(load)
  // A pending add from another store, waiting for the customer to confirm.
  const [replacePrompt, setReplacePrompt] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
    } catch {
      // Storage full or blocked: the cart still works for this visit.
    }
  }, [cart])

  const getQty = useCallback((id) => cart.lines.find((l) => l.key === String(id))?.quantity || 0, [cart])

  const setQty = useCallback((id, qty) => {
    setCart((c) => {
      const lines = c.lines
        .map((l) => (l.key === String(id) ? { ...l, quantity: Math.max(0, qty) } : l))
        .filter((l) => l.quantity > 0)
      return lines.length ? { ...c, lines } : empty
    })
  }, [])

  const addProduct = useCallback((product, fallbackStore) => {
    const store = productStore(product, fallbackStore)
    if (!store.id) {
      toast.error("This product has no store to order from")
      return false
    }
    if (cart.storeId && cart.storeId !== store.id && cart.lines.length) {
      setReplacePrompt({ product, store })
      return false
    }
    const base = cart.storeId === store.id ? cart : empty
    const existing = base.lines.find((l) => l.key === productId(product))
    if (existing) {
      if (existing.maxQty != null && existing.quantity >= existing.maxQty) {
        toast.error(`Only ${existing.maxQty} of ${existing.name} can be ordered`)
        return false
      }
      setCart({ ...base, lines: base.lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l)) })
      return true
    }
    setCart({ storeId: store.id, storeName: store.name || base.storeName, lines: [...base.lines, lineFrom(product, store)] })
    return true
  }, [cart])

  const confirmReplace = useCallback(() => {
    if (!replacePrompt) return
    const { product, store } = replacePrompt
    setCart({ storeId: store.id, storeName: store.name, lines: [lineFrom(product, store)] })
    setReplacePrompt(null)
  }, [replacePrompt])

  const clear = useCallback(() => setCart(empty), [])

  const value = useMemo(() => {
    const itemCount = cart.lines.reduce((s, l) => s + l.quantity, 0)
    const total = cart.lines.reduce((s, l) => s + l.quantity * l.price, 0)
    return {
      cart,
      itemCount,
      total,
      getQty,
      setQty,
      addProduct,
      clear,
      replacePrompt,
      confirmReplace,
      cancelReplace: () => setReplacePrompt(null),
    }
  }, [cart, getQty, setQty, addProduct, clear, replacePrompt, confirmReplace])

  return <QuickCartContext.Provider value={value}>{children}</QuickCartContext.Provider>
}

export const useQuickCart = () => {
  const ctx = useContext(QuickCartContext)
  if (!ctx) throw new Error("useQuickCart must be used inside QuickCartProvider")
  return ctx
}
