import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { catalogAPI, orderAPI } from "@/services/api"
import { useCart } from "@store/context/CartContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { channelAvailability } from "@store/utils/channelStock"
import { mediaUrl } from "../desktop/desktopCart"

/**
 * "Buy Again" from the orders list lands on the right cart with
 * `?reorder=<orderId>`. Each line goes back in at today's price, with the same
 * size or colour, unless it is no longer sold or out of stock, and the
 * customer is told how many made it.
 *
 * It has to run inside that store's cart, because Shop and Quick keep
 * separate carts, so it is rendered by the layout rather than the orders page.
 */
export default function ReorderIntake() {
  const location = useLocation()
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const { isQuick } = useStoreMode()
  const handled = useRef("")

  const orderId = new URLSearchParams(location.search).get("reorder") || ""

  useEffect(() => {
    if (!orderId || handled.current === orderId) return
    handled.current = orderId
    const channel = isQuick ? "quick" : "shop"
    const clear = () => {
      const params = new URLSearchParams(location.search)
      params.delete("reorder")
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true })
    }

    ;(async () => {
      try {
        const res = await orderAPI.getOrderDetails(orderId)
        const order = res?.data?.data?.order || res?.data?.order || null
        const items = order?.items || []
        const seller =
          order?.sellerId && typeof order.sellerId === "object"
            ? order.sellerId
            : { _id: order?.sellerId, sellerName: order?.sellerName || order?.seller }
        let added = 0
        for (const item of items) {
          const id = String(item.itemId || "")
          if (!id) continue
          const product = await catalogAPI
            .getProduct(id)
            .then((r) => r?.data?.data?.product || null)
            .catch(() => null)
          if (!product) continue
          const variant = item.variantId
            ? (product.variants || []).find((v) => String(v._id || v.id) === String(item.variantId)) || null
            : null
          if (item.variantId && !variant) continue
          if (!channelAvailability(product, channel, variant).inStock) continue
          const price = Number(variant?.price ?? product.price) || Number(item.price) || 0
          const mrp = Number(variant?.mrp ?? variant?.compareAtPrice ?? product.mrp ?? product.otherPrice) || 0
          const result = addToCart({
            id,
            itemId: id,
            productId: id,
            name: product.name || item.name,
            price,
            variantId: variant ? String(variant._id || variant.id) : null,
            variantName: variant?.name || item.variantName || "",
            variantPrice: price,
            otherPrice: mrp,
            image: mediaUrl(variant?.images?.[0] || product.images?.[0] || product.image || item.image || ""),
            seller: seller.sellerName || "Store",
            sellerName: seller.sellerName || "Store",
            sellerId: String(seller._id || product.sellerId || ""),
            channels: product.channels,
          }, null, { quantity: Number(item.quantity) || 1 })
          // A Quick cart holds one store; the cart is now asking to replace it.
          if (result?.needsConfirmation) return
          if (result?.ok !== false) added += 1
        }
        if (!items.length) toast.error("Couldn't find that order")
        else if (!added) toast.error("None of these items are available right now")
        else if (added < items.length) toast.success(`Added ${added} of ${items.length} items. The rest aren't available now.`)
        else toast.success(added === 1 ? "Added to your cart" : `Added all ${added} items to your cart`)
      } catch {
        toast.error("Couldn't reorder right now")
      } finally {
        clear()
      }
    })()
  }, [orderId, isQuick, addToCart, location.pathname, location.search, navigate])

  return null
}
