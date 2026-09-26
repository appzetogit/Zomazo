import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { RotateCcw } from "lucide-react"
import { catalogAPI, orderAPI } from "@/services/api"
import { useStoreMode } from "@store/context/StoreModeContext"
import { isModuleAuthenticated } from "@store/utils/auth"
import QuickProductCard from "@store/components/user/desktop/quick/QuickProductCard"
import { QUICK_GRID, QuickGridSkeleton } from "@store/components/user/desktop/quick/QuickRail"
import ProductCard from "@store/components/user/storefront/ProductCard"
import { useDesktopAddToCart } from "@store/components/user/desktop/desktopCart"

/**
 * Order Again (QUICK_MOBILE_SPEC.md, Q5): everything the customer has bought
 * before, newest first, ready to add back to the cart. Products no longer sold
 * are left out rather than shown as dead cards.
 */

const MAX_ITEMS = 24

export default function OrderAgain() {
  const { isQuick, storePath } = useStoreMode()
  const addToCart = useDesktopAddToCart()
  const signedIn = isModuleAuthenticated("user")
  const [state, setState] = useState({ loading: true, products: [] })

  useEffect(() => {
    if (!signedIn) {
      setState({ loading: false, products: [] })
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await orderAPI.getOrders({ page: 1, limit: 20 })
        const d = res?.data?.data
        const orders = d?.orders || (Array.isArray(d) ? d : []) || []
        const ids = []
        for (const order of orders) {
          for (const item of order?.items || []) {
            const id = String(item?.itemId || item?.productId || "")
            if (id && !ids.includes(id)) ids.push(id)
          }
        }
        const found = await Promise.all(
          ids.slice(0, MAX_ITEMS).map((id) =>
            catalogAPI
              .getProduct(id)
              .then((r) => r?.data?.data?.product || null)
              .catch(() => null),
          ),
        )
        if (!cancelled) setState({ loading: false, products: found.filter(Boolean) })
      } catch {
        if (!cancelled) setState({ loading: false, products: [] })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn])

  return (
    <div className="wh-desktop min-h-screen bg-wh-surface px-4 pb-10 pt-4 sm:px-5">
      <div className="mx-auto max-w-[1500px]">
        <h1 className="flex items-center gap-2 text-[22px] font-black tracking-tight text-wh-text">
          <RotateCcw className="h-5 w-5" aria-hidden="true" /> Order again
        </h1>
        <p className="mb-4 text-[13px] text-wh-muted">Everything you have bought before, one tap from your cart.</p>

        {!signedIn ? (
          <div className="rounded-2xl border border-wh-border bg-wh-brand-50 p-6 text-center">
            <p className="text-[15px] font-semibold text-wh-text">Sign in to see what you ordered before.</p>
            <Link
              to="/auth/login"
              state={{ from: storePath("/order-again") }}
              className="mt-3 inline-block rounded-lg bg-wh-brand px-4 py-2 text-[14px] font-bold text-wh-text"
            >
              Sign in
            </Link>
          </div>
        ) : state.loading ? (
          <QuickGridSkeleton count={8} />
        ) : state.products.length ? (
          <div className={QUICK_GRID}>
            {state.products.map((product) =>
              isQuick ? (
                <QuickProductCard key={product._id} product={product} />
              ) : (
                <ProductCard key={product._id} product={product} onAction={addToCart} />
              ),
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-wh-border p-8 text-center">
            <p className="text-[15px] font-semibold text-wh-text">Nothing to order again yet.</p>
            <p className="mt-1 text-[13px] text-wh-muted">Once your first order arrives, it will be here.</p>
            <Link
              to={storePath("/")}
              className="mt-3 inline-block rounded-lg bg-wh-brand px-4 py-2 text-[14px] font-bold text-wh-text"
            >
              Start shopping
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
