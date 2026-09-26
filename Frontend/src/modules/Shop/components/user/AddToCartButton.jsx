import { Plus, Minus } from "lucide-react"
import { Button } from "@store/components/ui/button"
import { useCart } from "@store/context/CartContext"
import { toast } from "sonner"

export default function AddToCartButton({ item, className = "" }) {
  const { addToCart, isInCart, getCartItem, updateQuantity } = useCart()
  const inCart = isInCart(item.id)
  const cartItem = getCartItem(item.id)

  const handleAddToCart = (e) => {
    e.preventDefault()
    e.stopPropagation()

    // Guests may fill a cart; signing in is asked for at checkout.
    const result = addToCart(item)
    if (result?.ok === false && !result.needsConfirmation) {
      toast.error(result.error || "Could not add this item to your cart")
    }
  }

  const handleIncrease = (e) => {
    e.preventDefault()
    e.stopPropagation()
    updateQuantity(item.id, (cartItem?.quantity || 0) + 1)
  }

  const handleDecrease = (e) => {
    e.preventDefault()
    e.stopPropagation()
    updateQuantity(item.id, (cartItem?.quantity || 0) - 1)
  }

  if (inCart) {
    return (
      <div className={`flex items-center gap-2 ${className}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <div className="flex items-center gap-1 border border-wh-brand rounded-md">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-6 hover:bg-gray-100"
            onClick={handleDecrease}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="px-1 text-sm font-semibold min-w-[1rem] text-center">
            {cartItem?.quantity || 0}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-6 hover:bg-gray-100"
            onClick={handleIncrease}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Button
      size="sm"
      onClick={handleAddToCart}
      className="bg-wh-brand hover:opacity-90 text-wh-text"
    >
      Add to Cart
    </Button>
  )
}
