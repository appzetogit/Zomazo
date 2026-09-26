/**
 * Desktop storefront helpers shared by the listing tiles and the Quick UI:
 * resolving media URLs and adding a product to the current store's cart.
 * Kept in its own module so quick/* and ListingDesktop don't import each other.
 */
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useCart } from "@store/context/CartContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { API_BASE_URL } from "@store/api/config"

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api(\/v\d+)?\/?$/, "")

/** Absolute URL for an image field that may be a bare /uploads path. */
export function mediaUrl(value) {
  const url = typeof value === "string" ? value : value?.url
  if (typeof url !== "string" || !url.trim()) return ""
  const t = url.trim()
  if (/^(https?:)?\/\//i.test(t) || /^(data|blob):/i.test(t)) return t
  return `${BACKEND_ORIGIN}${t.startsWith("/") ? "" : "/"}${t}`
}

const firstImage = (p) => mediaUrl(p?.imageUrl || p?.image || (Array.isArray(p?.images) ? p.images[0] : ""))

/**
 * Add a product without options straight to the cart; products with variants
 * open their page. Guests may fill a cart just as they can from a product
 * page — signing in is asked for at checkout.
 */
export function useDesktopAddToCart() {
  const { addToCart } = useCart()
  const { storePath } = useStoreMode()
  const navigate = useNavigate()
  return (product, sellerOverride = null) => {
    const id = product?._id || product?.id
    if (!id) return
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      navigate(storePath(`/product/${id}`))
      return
    }
    const seller = sellerOverride || product.seller || {}
    const sellerName = seller.name || seller.sellerName || "Store"
    const result = addToCart({
      id,
      itemId: id,
      productId: id,
      name: product.name,
      price: product.displayPrice ?? product.price,
      variantId: null,
      variantName: "",
      variantPrice: product.displayPrice ?? product.price,
      otherPrice: product.mrp,
      image: firstImage(product),
      seller: sellerName,
      sellerName,
      sellerId: seller._id || seller.id || product.sellerId,
      channels: product.channels,
    })
    if (result?.ok === false) {
      if (!result.needsConfirmation) toast.error(result.error || "Could not add this item to your cart")
      return
    }
    toast.success(`Added ${product.name} to cart`)
  }
}
