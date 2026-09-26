/**
 * The floating cart bar and the store-switch prompt.
 *
 * The bar is the Shop's QuickCartBottomBar: "{n} items · ₹total, View cart" in
 * brand ink, over every page except the cart itself.
 */
import { Link, useLocation } from "react-router-dom"
import { ShoppingCart } from "lucide-react"
import { useQuickCart } from "../context/QuickCartContext"
import { cx, focusRing, formatMoney } from "../helpers"

export function CartBar() {
  const { itemCount, total, cart } = useQuickCart()
  const { pathname } = useLocation()
  if (!itemCount || /^\/quick\/(cart|orders)/.test(pathname)) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 px-3 wh-slide-up-bar">
      <Link to="/quick/cart"
        className={cx("pointer-events-auto mx-auto flex max-w-[560px] items-center justify-between gap-3 rounded-[12px] bg-wh-brand-ink px-4 py-3 text-white shadow-lg", focusRing)}>
        <span className="flex items-center gap-2.5">
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          <span className="leading-tight">
            <span className="block text-[14px] font-bold">{itemCount} item{itemCount === 1 ? "" : "s"} · ₹{formatMoney(total)}</span>
            {cart.storeName ? <span className="block text-[11px] text-white/80">from {cart.storeName}</span> : null}
          </span>
        </span>
        <span className="text-[14px] font-bold">View cart →</span>
      </Link>
    </div>
  )
}

/** Adding from a second store: the cart holds one store's items, so ask first. */
export function ReplaceStoreDialog() {
  const { replacePrompt, confirmReplace, cancelReplace, cart } = useQuickCart()
  if (!replacePrompt) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="qc-replace-title">
      <div className="w-full max-w-[420px] rounded-[14px] bg-white p-5 shadow-xl">
        <h2 id="qc-replace-title" className="text-[17px] font-bold text-wh-text">Start a new cart?</h2>
        <p className="mt-2 text-[14px] leading-5 text-wh-muted">
          Your cart has items from <strong className="text-wh-text">{cart.storeName || "another store"}</strong>. Each quick order comes from one store,
          so adding this from <strong className="text-wh-text">{replacePrompt.store.name || "this store"}</strong> clears the cart.
        </p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={cancelReplace} className={cx("h-11 flex-1 rounded-[10px] border border-wh-border text-[14px] font-semibold", focusRing)}>
            Keep my cart
          </button>
          <button type="button" onClick={confirmReplace} className={cx("h-11 flex-1 rounded-[10px] bg-wh-brand-ink text-[14px] font-bold text-white", focusRing)}>
            Start new cart
          </button>
        </div>
      </div>
    </div>
  )
}
