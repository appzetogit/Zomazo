import { useEffect, useState } from "react"
import { useNavigate } from "@shop/router"
import { Zap } from "lucide-react"
import { useCart } from "@shop/context/CartContext"
import { cartStorageKeyFor, storePathFor, useStoreMode } from "@shop/context/StoreModeContext"

/**
 * Shop and Quick keep separate carts and check out separately: a Quick order
 * goes by rider in minutes, a Shop order by courier in days, so they are never
 * placed together. This switch sits on the cart page and moves between the
 * two, with each cart's item count, so neither is forgotten.
 */

function countStored(mode) {
  try {
    const list = JSON.parse(localStorage.getItem(cartStorageKeyFor(mode)) || "[]")
    return Array.isArray(list) ? list.reduce((n, line) => n + (Number(line?.quantity) || 0), 0) : 0
  } catch {
    return 0
  }
}

export default function CartSwitch({ className = "" }) {
  const navigate = useNavigate()
  const { isQuick } = useStoreMode()
  const { getCartCount } = useCart()
  const here = getCartCount()
  const otherMode = isQuick ? "shop" : "quick"
  const [other, setOther] = useState(() => countStored(otherMode))

  // The other cart lives in another provider; re-read it when it may have changed.
  useEffect(() => {
    const refresh = () => setOther(countStored(otherMode))
    refresh()
    window.addEventListener("storage", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      window.removeEventListener("storage", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [otherMode])

  const counts = { shop: isQuick ? other : here, quick: isQuick ? here : other }
  const tab = (mode, label) => {
    const active = (mode === "quick") === isQuick
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => !active && navigate(storePathFor(mode, "/cart"))}
        className={`flex flex-1 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors ${
          active ? "bg-[#EA580C] text-white shadow-sm" : "text-gray-600 dark:text-gray-300"
        }`}
      >
        {mode === "quick" ? <Zap className={`h-3.5 w-3.5 ${active ? "fill-white" : "fill-amber-400 text-amber-500"}`} aria-hidden="true" /> : null}
        {label}
        <span
          className={`min-w-[20px] rounded-full px-1.5 text-[11px] leading-5 ${
            active ? "bg-white/25 text-white" : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          }`}
        >
          {counts[mode]}
        </span>
      </button>
    )
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label="Which cart" className="flex rounded-full bg-gray-100 p-1 dark:bg-[#222]">
        {tab("shop", "Shop cart")}
        {tab("quick", "Quick cart")}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-gray-500 dark:text-gray-400">
        {isQuick ? "Quick orders come by rider in minutes." : "Shop orders come by courier in a few days."} Each cart checks out on its own.
      </p>
    </div>
  )
}
