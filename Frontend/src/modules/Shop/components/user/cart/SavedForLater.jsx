/**
 * "Saved for later" under the cart (mobile + desktop), per storefront. Lines
 * are kept on the server; "Move to cart" is re-checked there for the channel
 * (listed, store approved, in stock) before the line is added back.
 */
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, ShoppingBag } from "lucide-react"
import { toast } from "sonner"
import { userAPI } from "@store/api"
import { useCart } from "@store/context/CartContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { isModuleAuthenticated } from "@store/utils/auth"

const CHANGED_EVENT = "store_saved_for_later_changed"
const RUPEE = "₹"
const cartMode = (storeMode) => (storeMode === "quick" ? "quick" : "shop")
const errorMessage = (e, fallback) => e?.response?.data?.message || fallback

/**
 * Take a line out of the cart and park it. Removes it locally only after the
 * server has it, so a failed save never loses the line.
 */
export async function saveCartLineForLater({ item, storeMode, removeFromCart }) {
  if (!isModuleAuthenticated("user")) {
    toast.error("Sign in to save items for later")
    return false
  }
  const productId = String(item?.productId || item?.itemId || "")
  if (!/^[a-f0-9]{24}$/i.test(productId)) {
    toast.error("This item can't be saved for later")
    return false
  }
  try {
    await userAPI.saveForLater({
      mode: cartMode(storeMode),
      productId,
      variantId: item.variantId || undefined,
      qty: Math.max(1, Math.min(99, Number(item.quantity) || 1)),
    })
    removeFromCart(item.id)
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
    toast.success(`${item.name || "Item"} saved for later`)
    return true
  } catch (e) {
    toast.error(errorMessage(e, "Could not save this item"))
    return false
  }
}

export default function SavedForLater({ variant = "mobile", className = "" }) {
  const { storeMode, addToCart } = useCart()
  const { storePath } = useStoreMode()
  const mode = cartMode(storeMode)
  const signedIn = isModuleAuthenticated("user")
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    try {
      const res = await userAPI.getSavedForLater(mode)
      setItems(res?.data?.data?.items || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [mode, signedIn])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener(CHANGED_EVENT, load)
    return () => window.removeEventListener(CHANGED_EVENT, load)
  }, [load])

  const moveToCart = async (row) => {
    setBusyId(row.id)
    try {
      const res = await userAPI.moveSavedToCart(row.id)
      const line = res?.data?.data?.line
      if (line && Number(line.quantity) > 0) {
        const result = addToCart(line, null, { quantity: line.quantity })
        if (result?.ok === false) {
          // Keep the row: the item is still saved, not moved.
          if (!result.needsConfirmation) {
            toast.error(result.error || "Could not move this item to your cart")
          }
          load()
          return
        }
      }
      setItems((prev) => prev.filter((r) => r.id !== row.id))
      toast.success(line?.quantityReduced ? `Moved to cart (only ${line.cartQuantity} available)` : "Moved to cart")
    } catch (e) {
      toast.error(errorMessage(e, "Could not move this item to your cart"))
      load()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (row) => {
    setBusyId(row.id)
    try {
      await userAPI.removeSavedForLater(row.id)
      setItems((prev) => prev.filter((r) => r.id !== row.id))
    } catch (e) {
      toast.error(errorMessage(e, "Could not remove this item"))
    } finally {
      setBusyId(null)
    }
  }

  if (!signedIn || (!loading && items.length === 0)) return null
  const desktop = variant === "desktop"

  return (
    <section
      aria-labelledby="saved-for-later-heading"
      className={`${desktop
        ? "rounded-[8px] bg-wh-surface px-5 py-5 text-wh-text"
        : "rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm dark:border-gray-800 dark:bg-[#1a1a1a]"} ${className}`}
    >
      <h2
        id="saved-for-later-heading"
        className={desktop ? "border-b border-wh-border pb-2 text-[21px] font-bold" : "text-sm font-bold text-gray-900 dark:text-white"}
      >
        Saved for later ({items.length} item{items.length === 1 ? "" : "s"})
      </h2>
      {loading && !items.length ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-label="Loading saved items" /></div>
      ) : (
        <ul className={desktop ? "divide-y divide-wh-border" : "mt-3 space-y-3"}>
          {items.map((row) => (
            <li key={row.id} className={`flex items-start gap-3 ${desktop ? "py-4" : ""}`}>
              <Link
                to={storePath(`/product/${row.productId}`)}
                className={`flex shrink-0 items-center justify-center overflow-hidden rounded bg-[#F7F7F7] focus-visible:outline-2 focus-visible:outline-wh-brand ${desktop ? "h-[120px] w-[120px]" : "h-16 w-16"}`}
              >
                {row.image ? (
                  <img src={row.image} alt={row.name} loading="lazy" className="h-full w-full object-contain" />
                ) : (
                  <ShoppingBag className="h-6 w-6 text-gray-300" aria-hidden="true" />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <p className={desktop ? "text-[16px] leading-6" : "text-sm font-medium text-gray-800 dark:text-gray-200"}>{row.name}</p>
                {row.variantName ? <p className="text-xs text-gray-500 dark:text-gray-400">{row.variantName}</p> : null}
                <p className={`mt-0.5 ${desktop ? "text-[16px] font-bold" : "text-sm font-semibold text-gray-900 dark:text-white"}`}>
                  {RUPEE}{Number(row.price || 0).toLocaleString("en-IN")}
                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">Qty {row.qty}</span>
                </p>
                {row.available ? (
                  <p className="text-[12px] text-wh-success">In stock</p>
                ) : (
                  <p className="text-[12px] font-medium text-wh-deal">{row.message || "Currently unavailable"}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                  <button
                    type="button"
                    disabled={!row.available || busyId === row.id}
                    onClick={() => moveToCart(row)}
                    className="rounded-full border border-[#FCD200] bg-wh-cta px-3 py-1 font-medium text-wh-text hover:bg-wh-cta-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-wh-brand"
                  >
                    Move to cart
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => remove(row)}
                    className="text-wh-link hover:text-wh-link-hover hover:underline disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-wh-brand"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
