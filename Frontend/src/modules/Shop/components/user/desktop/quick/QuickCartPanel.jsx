/**
 * Quick desktop cart: a slide-in panel from the right plus the dismissible
 * bottom bar (QUICK_UI_SPEC.md, "Cart").
 *
 * Both read and write the existing per-store cart through CartContext, so the
 * header count, the cart page and checkout stay in sync. "Proceed to checkout"
 * just navigates to the existing cart route — no pricing or checkout logic here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react"
import { useCart } from "@store/context/CartContext"
import { useStoreMode } from "@store/context/StoreModeContext"
import { ImagePlaceholder, isRealImage } from "../ui"
import { useQuickEta } from "../useDeliveryEstimates"
import { mediaUrl } from "../desktopCart"
import { cx, focusRing, formatMoney } from "./quickHelpers"

const QuickCartUIContext = createContext({ open: false, openPanel: () => {}, closePanel: () => {}, enabled: false })

/** `{ open, openPanel, closePanel, enabled }`; `enabled` is false outside the provider. */
export function useQuickCartPanel() {
  return useContext(QuickCartUIContext)
}

export function QuickCartUIProvider({ children }) {
  const [open, setOpen] = useState(false)
  const openPanel = useCallback(() => setOpen(true), [])
  const closePanel = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ open, openPanel, closePanel, enabled: true }), [open, openPanel, closePanel])
  return <QuickCartUIContext.Provider value={value}>{children}</QuickCartUIContext.Provider>
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function CartLineStepper({ line }) {
  const { updateQuantity } = useCart()
  const qty = Number(line.quantity) || 0
  return (
    <div
      className="flex h-[30px] w-[86px] items-stretch overflow-hidden rounded-[6px] bg-wh-brand-ink text-[13px] font-semibold text-white"
      role="group"
      aria-label={`Quantity of ${line.name}`}
    >
      <button
        type="button"
        onClick={() => updateQuantity(line.id, qty - 1)}
        aria-label={qty === 1 ? `Remove ${line.name} from cart` : `Decrease quantity of ${line.name}`}
        className={cx("flex w-[26px] items-center justify-center hover:bg-[#93400a]", focusRing)}
      >
        {qty === 1 ? <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <span className="flex flex-1 items-center justify-center tabular-nums">{qty}</span>
      <button
        type="button"
        onClick={() => updateQuantity(line.id, qty + 1)}
        aria-label={`Increase quantity of ${line.name}`}
        className={cx("flex w-[26px] items-center justify-center hover:bg-[#93400a]", focusRing)}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

function CartLine({ line }) {
  const { storePath } = useStoreMode()
  const img = mediaUrl(line.image || line.imageUrl)
  const lineTotal = (Number(line.price) || 0) * (Number(line.quantity) || 0)
  const productHref = storePath(`/product/${line.productId || line.itemId}`)
  return (
    <li className="flex items-start gap-3 border-b border-wh-border py-3 last:border-b-0">
      <Link
        to={productHref}
        className={cx("flex h-[56px] w-[56px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#F7F7F7]", focusRing)}
      >
        {isRealImage(img) ? (
          <img src={img} alt={line.name} loading="lazy" className="h-full w-full object-contain mix-blend-multiply" />
        ) : (
          <ImagePlaceholder name={line.name} />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={productHref} className={cx("line-clamp-2 text-[13px] font-medium leading-[17px] hover:text-wh-link-hover", focusRing)}>
          {line.name}
        </Link>
        {line.variantName ? <p className="text-[12px] text-wh-muted">{line.variantName}</p> : null}
        <p className="mt-1 text-[13px] font-bold">₹{formatMoney(lineTotal)}</p>
      </div>
      <CartLineStepper line={line} />
    </li>
  )
}

function QuickCartSlidePanel() {
  const { open, closePanel } = useQuickCartPanel()
  const { cart, itemCount, total } = useCart()
  const { storePath } = useStoreMode()
  const navigate = useNavigate()
  const eta = useQuickEta()
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  // Escape closes, Tab stays inside, and focus returns where it came from.
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        closePanel()
        return
      }
      if (e.key !== "Tab") return
      const nodes = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []).filter(
        (el) => el.offsetParent !== null,
      )
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, closePanel])

  if (!open) return null

  const lines = Array.isArray(cart) ? cart : []

  return (
    <div className="wh-desktop fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Your quick cart">
      <button type="button" aria-label="Close cart" onClick={closePanel} className="absolute inset-0 h-full w-full cursor-default bg-black/50" />
      <div
        ref={panelRef}
        className="wh-slide-in-right absolute right-0 top-0 flex h-full w-full max-w-[400px] flex-col bg-wh-surface text-wh-text shadow-2xl"
      >
        <div className="flex h-[56px] shrink-0 items-center justify-between border-b border-wh-border px-4">
          <h2 className="text-[16px] font-bold">
            My cart{itemCount ? <span className="ml-1 text-[13px] font-medium text-wh-muted">({itemCount})</span> : null}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={closePanel}
            aria-label="Close cart"
            className={cx("flex h-8 w-8 items-center justify-center rounded-[6px] hover:bg-[#F0F2F2]", focusRing)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <ShoppingCart className="h-10 w-10 text-wh-muted" aria-hidden="true" />
            <p className="text-[15px] font-bold">Your cart is empty</p>
            <p className="text-[13px] text-wh-muted">Add something and we&apos;ll get it to you in about {eta} minutes.</p>
            <button
              type="button"
              onClick={closePanel}
              className={cx("mt-1 rounded-[6px] border border-wh-brand-ink bg-wh-brand-50 px-4 py-2 text-[13px] font-semibold text-wh-brand-ink hover:bg-wh-brand hover:text-wh-text", focusRing)}
            >
              Start shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 bg-wh-brand-50 px-4 py-2 text-[12px] font-medium text-wh-text">
              Delivery in about {eta} minutes
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-4">
              {lines.map((line) => (
                <CartLine key={line.id} line={line} />
              ))}
            </ul>
            <div className="shrink-0 border-t border-wh-border p-4">
              <h3 className="mb-2 text-[13px] font-bold">Bill summary</h3>
              <dl className="space-y-1 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-wh-muted">Items total</dt>
                  <dd>₹{formatMoney(total)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-wh-muted">Delivery, taxes &amp; savings</dt>
                  <dd className="text-wh-muted">Applied at checkout</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  closePanel()
                  navigate(storePath("/cart"))
                }}
                className={cx(
                  "mt-3 flex h-[42px] w-full items-center justify-center rounded-[8px] bg-wh-brand-ink text-[14px] font-bold text-white hover:bg-[#93400a]",
                  focusRing,
                )}
              >
                Proceed to checkout
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function QuickCartBottomBar() {
  const { open, openPanel } = useQuickCartPanel()
  const { itemCount, total } = useCart()
  const [dismissedAt, setDismissedAt] = useState(null)

  // A new add brings the bar back after a dismissal.
  useEffect(() => {
    if (dismissedAt != null && itemCount !== dismissedAt) setDismissedAt(null)
  }, [itemCount, dismissedAt])

  if (open || !itemCount || dismissedAt != null) return null

  return (
    // The strip spans the window, so it must not swallow clicks meant for the
    // buttons that float beside it; only the bar itself takes them.
    <div className="wh-desktop pointer-events-none fixed inset-x-0 bottom-[57px] z-[60] md:bottom-0">
      <div className="wh-slide-up-bar pointer-events-auto mx-3 mb-3 flex max-w-[520px] items-center gap-3 rounded-[12px] bg-wh-brand-ink px-4 py-3 text-white shadow-2xl sm:mx-auto md:mb-4">
        <span key={itemCount} className="wh-pop flex shrink-0">
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {itemCount} item{itemCount === 1 ? "" : "s"} · ₹{formatMoney(total)}
        </p>
        <button
          type="button"
          onClick={openPanel}
          className={cx("shrink-0 rounded-[6px] bg-white px-4 py-1.5 text-[13px] font-bold text-wh-brand-ink hover:bg-wh-brand-50", focusRing)}
        >
          View cart
        </button>
        <button
          type="button"
          onClick={() => setDismissedAt(itemCount)}
          aria-label="Hide cart bar"
          className={cx("shrink-0 rounded-[6px] p-1 hover:bg-white/20", focusRing)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/** The panel and the bottom bar together; render once, on /quick at lg+. */
export default function QuickCartDock() {
  return (
    <>
      <QuickCartSlidePanel />
      <QuickCartBottomBar />
    </>
  )
}
