/**
 * The bridge between a Quick product card and the real per-store cart.
 * Everything goes through CartContext (`useCart`), so the header count, the
 * cart page and checkout see exactly the same lines as before.
 */
import { useCart } from "@store/context/CartContext"
import { channelAvailability } from "@store/utils/channelStock"
import { useDesktopAddToCart } from "../desktopCart"
import { productHasOptions, productId } from "./quickHelpers"

/**
 * `{ qty, add, increase, decrease, inStock, hasOptions, atMax, availability }`
 * for one product in the quick channel.
 *
 * - `add` reuses useDesktopAddToCart: it asks for sign-in when needed and sends
 *   products with variants to their product page instead of adding blindly.
 * - `increase` / `decrease` call updateQuantity on the same cart line, and
 *   dropping to 0 removes the line (CartContext does that for us).
 */
export default function useQuickCartLine(product) {
  const { getCartItem, updateQuantity } = useCart()
  const addToCart = useDesktopAddToCart()

  const id = productId(product)
  const line = id ? getCartItem(id) : null
  const qty = Number(line?.quantity) || 0

  const availability = channelAvailability(product, "quick")
  const hasOptions = productHasOptions(product)
  // null stock means "not counted", so there is no ceiling to respect.
  const max = availability.qty == null ? Number.POSITIVE_INFINITY : Number(availability.qty)

  return {
    qty,
    line,
    hasOptions,
    availability,
    inStock: availability.inStock,
    atMax: qty >= max,
    add: () => addToCart(product),
    increase: () => {
      if (!id || qty >= max) return
      updateQuantity(id, qty + 1)
    },
    decrease: () => {
      if (!id || qty <= 0) return
      updateQuantity(id, qty - 1)
    },
  }
}
