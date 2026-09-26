// src/context/cart-context.jsx
import { cartStorageKeyFor } from "@store/context/StoreModeContext"
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildCartLineId } from "@store/utils/productVariants"
import { userAPI } from "@/services/api"
import { toast } from "sonner"
import CartReplaceDialog from "@store/components/user/CartReplaceDialog"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


// Default cart context value to prevent errors during initial render
const defaultCartContext = {
  _isProvider: false, // Flag to identify if this is from the actual provider
  cart: [],
  items: [],
  itemCount: 0,
  total: 0,
  lastAddEvent: null,
  lastRemoveEvent: null,
  addToCart: () => {
    debugWarn('CartProvider not available - addToCart called');
  },
  removeFromCart: () => {
    debugWarn('CartProvider not available - removeFromCart called');
  },
  updateQuantity: () => {
    debugWarn('CartProvider not available - updateQuantity called');
  },
  getCartCount: () => 0,
  isInCart: () => false,
  getCartItem: () => null,
  clearCart: () => {
    debugWarn('CartProvider not available - clearCart called');
  },
  cleanCartForSeller: () => {
    debugWarn('CartProvider not available - cleanCartForSeller called');
  },
  replaceCart: () => {
    debugWarn('CartProvider not available - replaceCart called');
  },
  confirmReplaceCart: () => {
    debugWarn('CartProvider not available - confirmReplaceCart called');
  },
  cancelReplaceCart: () => {
    debugWarn('CartProvider not available - cancelReplaceCart called');
  },
  cartReplacePrompt: null,
}

const CartContext = createContext(defaultCartContext)

/**
 * Whether a new line belongs to a different seller than the cart's first line.
 * Names are compared when both sides have one (ids come in several formats for
 * the same seller); otherwise ids decide. One rule, used both when deciding to
 * prompt and when writing the cart — when the two disagreed, an item could be
 * dropped while the caller was told it had been added.
 */
const isDifferentSeller = (existing, incoming) => {
    const name = (value) =>
        String(typeof value === "string" ? value : value?.name || "").trim().toLowerCase()
    const existingName = name(existing?.seller)
    const incomingName = name(incoming?.seller)
    if (existingName && incomingName) return existingName !== incomingName

    const existingId = existing?.sellerId
    const incomingId = incoming?.sellerId
    if (existingId && incomingId) return String(existingId) !== String(incomingId)
    return false
}

const normalizeCartData = (rawCart) => {
  if (!Array.isArray(rawCart)) return []

  return rawCart
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const parsedQuantity = Number(item.quantity)
      const parsedPrice = Number(item.price)
      const normalizedSellerName =
        typeof item.seller === "string"
          ? item.seller
          : typeof item.seller?.name === "string"
            ? item.seller.name
            : ""

      const normalizedSellerId =
        item.sellerId ||
        item.seller_id ||
        item.seller?._id ||
        item.seller?.sellerId ||
        null

      const normalizedImage =
        item.image ||
        item.imageUrl ||
        item.product?.imageUrl ||
        item.product?.image ||
        ""

      const baseItemId =
        item.itemId ||
        item.productId ||
        item.baseItemId ||
        item.menuItemId ||
        item.id ||
        item._id ||
        `cart-item-${index}`

      const variantId = item.variantId || item.variant?._id || item.variant?.id || ""
      const variantName =
        typeof item.variantName === "string"
          ? item.variantName
          : typeof item.variant?.name === "string"
            ? item.variant.name
            : ""
      const parsedVariantPrice = Number(
        item.variantPrice ?? item.variant?.price ?? item.price,
      )
      const lineItemId =
        item.lineItemId ||
        item.cartLineId ||
        buildCartLineId(baseItemId, variantId)

        const name = item.name || item.product?.name || "Item";

        const finalFoodType =
          item.foodType === "Veg" || item.foodType === "Non-Veg"
            ? item.foodType
            : typeof item.isVeg === "boolean"
              ? (item.isVeg ? "Veg" : "Non-Veg")
              : null;

        return {
          ...item,
          id: lineItemId,
          lineItemId,
          itemId: String(baseItemId),
          productId: String(baseItemId),
          variantId: variantId ? String(variantId) : "",
          variantName,
          variantPrice: Number.isFinite(parsedVariantPrice) ? parsedVariantPrice : 0,
          name: name,
          quantity:
            Number.isFinite(parsedQuantity) && parsedQuantity > 0
              ? Math.floor(parsedQuantity)
              : 1,
          price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
          otherPrice: Number(item.otherPrice) > 0 ? Number(item.otherPrice) : 0,
          foodType: finalFoodType,
          isVeg: finalFoodType === "Veg" ? true : finalFoodType === "Non-Veg" ? false : null,
        seller: normalizedSellerName,
        sellerId: normalizedSellerId,
        image: normalizedImage,
        imageUrl: normalizedImage,
      }
    })
}

const resolveCartEntryId = (items, itemId, variantId = "") => {
  const normalizedItemId = String(itemId || "")
  const safeItems = Array.isArray(items) ? items : []

  const directMatch = safeItems.find((item) => item.id === normalizedItemId)
  if (directMatch) return directMatch.id

  const preferredId = buildCartLineId(normalizedItemId, variantId)

  const exactMatch = safeItems.find((item) => item.id === preferredId)
  if (exactMatch) return exactMatch.id

  if (!variantId) {
    const legacyBaseMatch = safeItems.find(
      (item) =>
        String(item.itemId || item.productId || item.id || "") === normalizedItemId &&
        !String(item.variantId || "").trim(),
    )
    if (legacyBaseMatch) return legacyBaseMatch.id
  }

  return preferredId
}

export function CartProvider({ children, mode = "shop" }) {
  // Each storefront (shop "/" and quick "/quick") keeps its own cart.
  const storageKey = cartStorageKeyFor(mode)
  // Safe init (works with SSR and bad JSON)
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return []
    try {
      const saved = localStorage.getItem(storageKey)
      const parsed = saved ? JSON.parse(saved) : []
      return normalizeCartData(parsed)
    } catch {
      return []
    }
  })
  // Track last add event for animation
  const [lastAddEvent, setLastAddEvent] = useState(null)
  // Track last remove event for animation
  const [lastRemoveEvent, setLastRemoveEvent] = useState(null)
  const [cartReplacePrompt, setCartReplacePrompt] = useState(null)

  // Persist to localStorage whenever cart changes
  useEffect(() => {
    try {
      // Only save if we have items or user is authenticated to avoid cluttering localStorage for every guest visitor
      const isAuthenticated = localStorage.getItem("user_authenticated") === "true" || !!localStorage.getItem("user_accessToken");
      if (cart.length > 0 || isAuthenticated) {
        localStorage.setItem(storageKey, JSON.stringify(normalizeCartData(cart)))
      }
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [cart, storageKey])

  const cartSyncTimerRef = useRef(null)

  const scheduleCartSync = useCallback(() => {
    if (typeof window === "undefined") return

    const isAuthenticated =
      localStorage.getItem("user_authenticated") === "true" ||
      !!localStorage.getItem("user_accessToken")

    if (!isAuthenticated) return

    if (cartSyncTimerRef.current) {
      clearTimeout(cartSyncTimerRef.current)
    }

    cartSyncTimerRef.current = setTimeout(() => {
      const items = normalizeCartData(cart)
      let pricing = null
      try {
        const rawPricing = sessionStorage.getItem("store_cart_pricing_snapshot")
        if (rawPricing) pricing = JSON.parse(rawPricing)
      } catch {
        pricing = null
      }
      userAPI.syncCart({ items, pricing, mode: mode === "quick" ? "quick" : "shop" }).catch(() => {})
    }, 1200)
  }, [cart, mode])

  // Sync cart to server for admin visibility (authenticated users only)
  useEffect(() => {
    scheduleCartSync()

    const handlePricingUpdated = () => {
      scheduleCartSync()
    }

    window.addEventListener("store_cart_pricing_updated", handlePricingUpdated)

    return () => {
      window.removeEventListener("store_cart_pricing_updated", handlePricingUpdated)
      if (cartSyncTimerRef.current) {
        clearTimeout(cartSyncTimerRef.current)
      }
    }
  }, [scheduleCartSync])

  // Restore the saved server cart for this storefront on app start and on login,
  // but only when this device's cart for the mode is empty. If both have items,
  // the local cart wins and the sync above pushes it up (PUT replaces, so
  // nothing is doubled).
  const cartRef = useRef(cart)
  cartRef.current = cart
  useEffect(() => {
    if (typeof window === "undefined") return undefined
    let alive = true
    const restore = async () => {
      const isAuthenticated =
        localStorage.getItem("user_authenticated") === "true" ||
        !!localStorage.getItem("user_accessToken")
      if (!isAuthenticated || normalizeCartData(cartRef.current).length > 0) return
      try {
        const res = await userAPI.getCart(mode === "quick" ? "quick" : "shop")
        const saved = res?.data?.data
        if (!alive || !Array.isArray(saved?.items) || saved.items.length === 0) return
        // The user may have added something while the request was in flight.
        if (normalizeCartData(cartRef.current).length > 0) return
        setCart(
          normalizeCartData(
            saved.items.map((item) => ({ ...item, seller: item.sellerName || item.seller || "" })),
          ),
        )
        const removed = Array.isArray(saved.removed) ? saved.removed : []
        const changed = Array.isArray(saved.changed) ? saved.changed : []
        window.dispatchEvent(new CustomEvent("store_cart_restored", { detail: { mode, removed, changed } }))
        if (removed.length || changed.length) {
          if (removed.length) toast.info(`${removed.length} item(s) from your saved cart are no longer available`)
          if (changed.length) toast.info("Some prices or quantities in your cart were updated")
        }
      } catch {
        // offline or not signed in: keep the local cart as it is
      }
    }
    restore()
    window.addEventListener("userAuthChanged", restore)
    return () => {
      alive = false
      window.removeEventListener("userAuthChanged", restore)
    }
  }, [mode])

  const addToCart = (item, sourcePosition = null, options = {}) => {
    const { forceReplace = false, quantity: requestedQuantity = 1 } = options
    const parsedQuantity = Number(requestedQuantity)
    const addQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? Math.floor(parsedQuantity)
        : 1

    const safeCart = normalizeCartData(cart)
    const isStandardMode = mode !== "quick"
    if (!forceReplace && safeCart.length > 0 && !isStandardMode) {
      const firstItemSellerName = safeCart[0]?.seller
      const newItemSellerName = item?.seller

      if (isDifferentSeller(safeCart[0], item)) {
        setCartReplacePrompt({
          item,
          sourcePosition,
          quantity: addQuantity,
          existingSellerName: firstItemSellerName || 'another seller',
          newSellerName: newItemSellerName || 'this seller',
        })
        return { ok: false, code: 'SELLER_MISMATCH', needsConfirmation: true }
      }
    }

    if (!item?.sellerId && !item?.seller) {
      return {
        ok: false,
        error: 'Item is missing seller information. Please refresh the page.',
        code: 'MISSING_SELLER'
      }
    }

    setCart((prev) => {
      const safePrev = forceReplace ? [] : normalizeCartData(prev)
      // Validate seller consistency only in quick mode (standard mode supports multi-vendor cart).
      // The caller was already asked to confirm above; this only guards a cart
      // that changed in between.
      if (!forceReplace && safePrev.length > 0 && !isStandardMode && isDifferentSeller(safePrev[0], item)) {
        debugError('❌ Cannot add item: the cart belongs to another seller', {
          cartSellerId: safePrev[0]?.sellerId,
          cartSellerName: safePrev[0]?.seller,
          newItemSellerId: item?.sellerId,
          newItemSellerName: item?.seller,
        });
        return safePrev;
      }

      const existing = safePrev.find((i) => i.id === item.id)
      if (existing) {
        // Set last add event for animation when incrementing existing item
        if (sourcePosition) {
          setLastAddEvent({
            product: {
              id: item.id,
              name: item.name,
              imageUrl: item.image || item.imageUrl,
            },
            sourcePosition,
          })
          // Clear after animation completes (increased delay)
          setTimeout(() => setLastAddEvent(null), 1500)
        }
        return safePrev.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + addQuantity } : i
        )
      }
      
      // Validate item has required seller info
      if (!item.sellerId && !item.seller) {
        debugError('❌ Cannot add item: Missing seller information!', item);
        return safePrev;
      }
      
      const newItem = { ...item, quantity: addQuantity }
      
      // Set last add event for animation if sourcePosition is provided
      if (sourcePosition) {
        setLastAddEvent({
          product: {
            id: item.id,
            name: item.name,
            imageUrl: item.image || item.imageUrl,
          },
          sourcePosition,
        })
        // Clear after animation completes (increased delay to allow full animation)
        setTimeout(() => setLastAddEvent(null), 1500)
      }
      
      return [...safePrev, newItem]
    })

    return { ok: true }
  }

  const cancelReplaceCart = () => {
    setCartReplacePrompt(null)
  }

  const confirmReplaceCart = () => {
    if (!cartReplacePrompt) return

    const { item, sourcePosition, quantity } = cartReplacePrompt
    setCartReplacePrompt(null)

    if (!item?.sellerId && !item?.seller) return

    const parsedQuantity = Number(quantity)
    const addQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? Math.floor(parsedQuantity)
        : 1

    setCart([{ ...item, quantity: addQuantity }])

    if (sourcePosition) {
      setLastAddEvent({
        product: {
          id: item.id,
          name: item.name,
          imageUrl: item.image || item.imageUrl,
        },
        sourcePosition,
      })
      setTimeout(() => setLastAddEvent(null), 1500)
    }
  }

  const removeFromCart = (itemId, sourcePosition = null, productInfo = null) => {
    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      const resolvedItemId = resolveCartEntryId(safePrev, itemId)
      const itemToRemove = safePrev.find((i) => i.id === resolvedItemId)
      if (itemToRemove && sourcePosition && productInfo) {
        // Set last remove event for animation
        setLastRemoveEvent({
          product: {
            id: productInfo.id || itemToRemove.id,
            name: productInfo.name || itemToRemove.name,
            imageUrl: productInfo.imageUrl || productInfo.image || itemToRemove.image || itemToRemove.imageUrl,
          },
          sourcePosition,
        })
        // Clear after animation completes
        setTimeout(() => setLastRemoveEvent(null), 1500)
      }
      return safePrev.filter((i) => i.id !== resolvedItemId)
    })
  }

  const updateQuantity = (itemId, quantity, sourcePosition = null, productInfo = null) => {
    const safeCart = normalizeCartData(cart)
    const resolvedItemId = resolveCartEntryId(safeCart, itemId)
    if (quantity <= 0) {
      setCart((prev) => {
        const safePrev = normalizeCartData(prev)
        const itemToRemove = safePrev.find((i) => i.id === resolvedItemId)
        if (itemToRemove && sourcePosition && productInfo) {
          // Set last remove event for animation
          setLastRemoveEvent({
            product: {
              id: productInfo.id || itemToRemove.id,
              name: productInfo.name || itemToRemove.name,
              imageUrl: productInfo.imageUrl || productInfo.image || itemToRemove.image || itemToRemove.imageUrl,
            },
            sourcePosition,
          })
          // Clear after animation completes
          setTimeout(() => setLastRemoveEvent(null), 1500)
        }
        return safePrev.filter((i) => i.id !== resolvedItemId)
      })
      return
    }
    
    // When quantity decreases (but not to 0), also trigger removal animation
    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      const existingItem = safePrev.find((i) => i.id === resolvedItemId)
      if (existingItem && quantity < existingItem.quantity && sourcePosition && productInfo) {
        // Set last remove event for animation when decreasing quantity
        setLastRemoveEvent({
          product: {
            id: productInfo.id || existingItem.id,
            name: productInfo.name || existingItem.name,
            imageUrl: productInfo.imageUrl || productInfo.image || existingItem.image || existingItem.imageUrl,
          },
          sourcePosition,
        })
        // Clear after animation completes
        setTimeout(() => setLastRemoveEvent(null), 1500)
      }
      return safePrev.map((i) => (i.id === resolvedItemId ? { ...i, quantity } : i))
    })
  }

  const getCartCount = () =>
    normalizeCartData(cart).reduce((total, item) => total + (item.quantity || 0), 0)

  const isInCart = (itemId, variantId = "") => {
    const safeCart = normalizeCartData(cart)
    const resolvedItemId = resolveCartEntryId(safeCart, itemId, variantId)
    return safeCart.some((i) => i.id === resolvedItemId)
  }

  const getCartItem = (itemId, variantId = "") => {
    const safeCart = normalizeCartData(cart)
    const resolvedItemId = resolveCartEntryId(safeCart, itemId, variantId)
    return safeCart.find((i) => i.id === resolvedItemId) || null
  }

  const clearCart = () => setCart([])

  const replaceCart = (items) => {
    const normalizedItems = normalizeCartData(items).filter((item) => {
      const quantity = Number(item?.quantity)
      return item?.id && (item?.sellerId || item?.seller) && Number.isFinite(quantity) && quantity > 0
    })

    setCart(normalizedItems)
    return { ok: true, count: normalizedItems.length }
  }

  // Clean cart to remove items from different sellers
  // Keeps only items from the specified seller
  const cleanCartForSeller = (sellerId, sellerName) => {
    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      if (safePrev.length === 0) return safePrev;
      
      // Normalize seller name for comparison
      const normalizeName = (name) => name ? name.trim().toLowerCase() : '';
      const targetSellerNameNormalized = normalizeName(sellerName);
      
      // Filter cart to keep only items from the target seller
      const cleanedCart = safePrev.filter((item) => {
        const itemSellerId = item?.sellerId;
        const itemSellerName = item?.seller;
        const itemSellerNameNormalized = normalizeName(itemSellerName);
        
        // Check by seller name first (more reliable)
        if (targetSellerNameNormalized && itemSellerNameNormalized) {
          return itemSellerNameNormalized === targetSellerNameNormalized;
        }
        // Fallback to ID comparison
        if (sellerId && itemSellerId) {
          return itemSellerId === sellerId || 
                 itemSellerId === sellerId.toString() ||
                 itemSellerId.toString() === sellerId;
        }
        // If no match, remove item
        return false;
      });
      
      if (cleanedCart.length !== safePrev.length) {
        debugWarn('🧹 Cleaned cart: Removed items from different sellers', {
          before: safePrev.length,
          after: cleanedCart.length,
          removed: safePrev.length - cleanedCart.length
        });
      }
      
      return cleanedCart;
    });
  }

  // Validate and clean cart on mount/load to prevent multiple seller items
  // This runs only once on initial load to clean up any corrupted cart data from localStorage
  useEffect(() => {
    const safeCart = normalizeCartData(cart)
    if (safeCart.length !== cart.length) {
      setCart(safeCart)
      return
    }
    if (safeCart.length === 0) return;
    
    // Get unique seller IDs and names
    const sellerIds = safeCart.map(item => item.sellerId).filter(Boolean);
    const sellerNames = safeCart.map(item => item.seller).filter(Boolean);
    const uniqueSellerIds = [...new Set(sellerIds)];
    const uniqueSellerNames = [...new Set(sellerNames)];
    
    // Normalize seller names for comparison
    const normalizeName = (name) => name ? name.trim().toLowerCase() : '';
    const uniqueSellerNamesNormalized = uniqueSellerNames.map(normalizeName);
    const uniqueSellerNamesSet = new Set(uniqueSellerNamesNormalized);
    
    // Check if cart has items from multiple sellers
    if (uniqueSellerIds.length > 1 || uniqueSellerNamesSet.size > 1) {
      debugWarn('⚠️ Cart contains items from multiple sellers. Cleaning cart...', {
        sellerIds: uniqueSellerIds,
        sellerNames: uniqueSellerNames
      });
      
      // Keep items from the first seller (most recent or first in cart)
      const firstSellerId = uniqueSellerIds[0];
      const firstSellerName = uniqueSellerNames[0];
      
      setCart((prev) => {
        const safePrev = normalizeCartData(prev)
        const normalizeName = (name) => name ? name.trim().toLowerCase() : '';
        const firstSellerNameNormalized = normalizeName(firstSellerName);
        
        return safePrev.filter((item) => {
          const itemSellerId = item?.sellerId;
          const itemSellerName = item?.seller;
          const itemSellerNameNormalized = normalizeName(itemSellerName);
          
          // Check by seller name first
          if (firstSellerNameNormalized && itemSellerNameNormalized) {
            return itemSellerNameNormalized === firstSellerNameNormalized;
          }
          // Fallback to ID comparison
          if (firstSellerId && itemSellerId) {
            return itemSellerId === firstSellerId || 
                   itemSellerId === firstSellerId.toString() ||
                   itemSellerId.toString() === firstSellerId;
          }
          return false;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount to clean up localStorage data

  // Transform cart to match AddToCartAnimation expected structure
  const cartForAnimation = useMemo(() => {
    const safeCart = normalizeCartData(cart)
    const items = safeCart.map(item => ({
      product: {
        id: item.id,
        name: item.name,
        imageUrl: item.image || item.imageUrl,
      },
      quantity: item.quantity || 1,
    }))
    
    const itemCount = safeCart.reduce((total, item) => total + (item.quantity || 0), 0)
    const total = safeCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)
    
    return {
      items,
      itemCount,
      total,
    }
  }, [cart])

  const value = useMemo(
    () => ({
      _isProvider: true, // Flag to identify this is from the actual provider
      storeMode: mode,
      fulfilmentMode: mode === "quick" ? "quick" : "standard",
      // Keep original cart array for backward compatibility
      cart,
      // Add animation-compatible structure
      items: cartForAnimation.items,
      itemCount: cartForAnimation.itemCount,
      total: cartForAnimation.total,
      lastAddEvent,
      lastRemoveEvent,
      addToCart,
      removeFromCart,
      updateQuantity,
      getCartCount,
      isInCart,
      getCartItem,
      clearCart,
      cleanCartForSeller,
      replaceCart,
      cartReplacePrompt,
      confirmReplaceCart,
      cancelReplaceCart,
    }),
    [cart, cartForAnimation, lastAddEvent, lastRemoveEvent, cartReplacePrompt, mode]
  )

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartReplaceDialog
        open={!!cartReplacePrompt}
        existingSellerName={cartReplacePrompt?.existingSellerName || "another seller"}
        newSellerName={cartReplacePrompt?.newSellerName || "this seller"}
        onConfirm={confirmReplaceCart}
        onCancel={cancelReplaceCart}
      />
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  // Check if context is from the actual provider by checking the _isProvider flag
  if (!context || context._isProvider !== true) {
    // In development, log a warning but don't throw to prevent crashes
    if (process.env.NODE_ENV === 'development') {
      debugWarn('⚠️ useCart called outside CartProvider. Using default values.');
      debugWarn('💡 Make sure the component is rendered inside UserLayout which provides CartProvider.');
    }
    // Return default context instead of throwing
    return defaultCartContext
  }
  return context
}

