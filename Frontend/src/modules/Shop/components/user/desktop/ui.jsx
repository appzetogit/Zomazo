/**
 * Shared desktop storefront pieces (DESKTOP_THEME.md). Desktop-only: use them
 * inside lg+ layouts so mobile stays unchanged.
 */
import { Link } from 'react-router-dom'
import { useStoreMode } from '@store/context/StoreModeContext'
import { formatDeliveryWindow, useQuickEta, useShopDeliveryEstimate } from './useDeliveryEstimates'

const cx = (...a) => a.filter(Boolean).join(' ')

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const fmt = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })

/** Percent off from price and MRP, or null when there's no discount. */
/**
 * Stand-in for a product with no photo: a soft tile with a bag glyph and the
 * product's initial, so empty catalogues still read as products.
 */
export function ImagePlaceholder({ name = '', className }) {
  const initial = String(name).trim().charAt(0).toUpperCase()
  return (
    <div
      role="img"
      aria-label={name ? `${name} (no photo yet)` : 'No photo yet'}
      className={cx('flex h-full w-full flex-col items-center justify-center gap-1 bg-[#F3F4F6] text-[#9CA3AF]', className)}
    >
      <svg viewBox="0 0 24 24" className="h-1/4 max-h-16 w-1/4 max-w-16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6 8h12l-1 12H7L6 8Z" strokeLinejoin="round" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      </svg>
      {initial ? <span className="text-[13px] font-bold">{initial}</span> : null}
    </div>
  )
}

/** A real photo, not the generated brand-name image used as a last resort. */
export const isRealImage = (src) => Boolean(src) && !String(src).startsWith('data:image/svg+xml')

export const percentOff = (price, mrp) => {
  const p = num(price)
  const m = num(mrp)
  if (p == null || m == null || m <= p || m <= 0) return null
  return Math.round(((m - p) / m) * 100)
}

/** "{n}% off" in deal red. Renders nothing without a positive percent. */
export function DealBadge({ percent, className }) {
  const n = num(percent)
  if (!n || n <= 0) return null
  return (
    <span className={cx('inline-block rounded-[4px] bg-wh-deal px-1.5 py-0.5 text-[12px] font-bold leading-4 text-white', className)}>
      {Math.round(n)}% off
    </span>
  )
}

/** Pill CTA: primary = Add to cart (--wh-cta), secondary = Buy now (--wh-cta-2). */
export function CtaButton({ variant = 'primary', children, className, type = 'button', ...buttonProps }) {
  const tone =
    variant === 'secondary'
      ? 'bg-wh-cta-2 hover:bg-wh-cta-2-hover border-[#FF8F00]'
      : 'bg-wh-cta hover:bg-wh-cta-hover border-[#FCD200]'
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-[34px] w-full items-center justify-center gap-1 rounded-full border px-4 text-[13px] font-medium text-wh-text shadow-sm',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand disabled:cursor-not-allowed disabled:opacity-50',
        tone,
        className,
      )}
      {...buttonProps}
    >
      {children}
    </button>
  )
}

/** Price with a small superscript ₹, plus struck-through M.R.P. when higher. */
export function PriceTag({ price, mrp, size = 'sm', className }) {
  const p = num(price)
  if (p == null) return null
  const m = num(mrp)
  const [whole, frac] = fmt(p).split('.')
  const lg = size === 'lg'
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-2 text-wh-text', className)}>
      <span className={cx('inline-flex items-start leading-none', lg ? 'text-[28px]' : 'text-[21px]')}>
        <span className={cx('mt-[2px]', lg ? 'text-[13px]' : 'text-[12px]')}>₹</span>
        <span>{whole}</span>
        {frac ? <span className={cx('mt-[2px]', lg ? 'text-[13px]' : 'text-[12px]')}>{frac}</span> : null}
      </span>
      {m != null && m > p ? (
        <span className="text-[12px] text-wh-muted">
          {lg ? 'M.R.P.: ' : ''}
          <s>₹{fmt(m)}</s>
        </span>
      ) : null}
    </span>
  )
}

/**
 * Delivery line in --wh-success: "Get it in N min" (Quick; N from the
 * customer's zone unless etaMinutes is passed) or "Delivery by {date}" (Shop;
 * from the delivery-estimate endpoint for their pincode unless date is passed).
 */
export function DeliveryPromise({ mode = 'shop', etaMinutes, date, className }) {
  const zoneEta = useQuickEta()
  const estimate = useShopDeliveryEstimate({ enabled: mode !== 'quick' && !date })
  let text
  if (mode === 'quick') {
    const n = num(etaMinutes)
    text = `Get it in ${n ? Math.round(n) : zoneEta} min`
  } else {
    const d = date ? new Date(date) : null
    const label =
      d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
        : typeof date === 'string' ? date : null
    text = label ? `Delivery by ${label}` : formatDeliveryWindow(estimate)
  }
  return <p className={cx('text-[13px] font-medium text-wh-success', className)}>{text}</p>
}

const productImage = (p) =>
  p?.imageUrl || p?.image || (Array.isArray(p?.images) ? (typeof p.images[0] === 'string' ? p.images[0] : p.images[0]?.url) : null) || ''

const productPrice = (p) => p?.price ?? p?.salePrice ?? p?.variants?.[0]?.price
const productMrp = (p) => p?.mrp ?? p?.originalPrice ?? p?.variants?.[0]?.mrp

/**
 * Result/carousel tile: image on light grey square, 2-line title, rating,
 * price + MRP + % off, optional delivery line and Add to cart pill.
 * Extra optional props: mode, etaMinutes, deliveryDate, compact (hides CTA).
 */
export function ProductTile({ product, onAddToCart, href, mode, etaMinutes, deliveryDate, compact = false, className }) {
  const { storePath } = useStoreMode()
  if (!product) return null
  const price = productPrice(product)
  const mrp = productMrp(product)
  const off = percentOff(price, mrp)
  const img = productImage(product)
  const name = product.name || product.title || 'Product'
  const rating = num(product.rating ?? product.averageRating)
  const to = href || (product._id || product.id ? storePath(`/product/${product._id || product.id}`) : '#')
  return (
    <div className={cx('flex h-full flex-col rounded-[8px] bg-wh-surface p-2 text-wh-text', className)}>
      <Link to={to} className="block rounded-[4px] focus-visible:outline-2 focus-visible:outline-wh-brand">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[4px] bg-[#F7F7F7]">
          {isRealImage(img) ? <img src={img} alt={name} loading="lazy" className="h-full w-full object-contain mix-blend-multiply" /> : <ImagePlaceholder name={name} />}
        </div>
      </Link>
      <div className="mt-2 flex flex-1 flex-col gap-1">
        {off ? (
          <div className="flex items-center gap-2">
            <DealBadge percent={off} />
            <span className="text-[12px] font-bold text-wh-deal">Limited time deal</span>
          </div>
        ) : null}
        <Link to={to} className="line-clamp-2 text-[14px] leading-5 hover:text-wh-link-hover">
          {name}
        </Link>
        {rating ? (
          <span className="text-[12px] text-wh-muted" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
            <span className="text-wh-brand">{'★'.repeat(Math.round(rating))}</span> {rating.toFixed(1)}
          </span>
        ) : null}
        <PriceTag price={price} mrp={mrp} />
        {mode ? <DeliveryPromise mode={mode} etaMinutes={etaMinutes} date={deliveryDate} /> : null}
        {!compact && onAddToCart ? (
          <div className="mt-auto pt-2">
            <CtaButton onClick={() => onAddToCart(product)}>Add to cart</CtaButton>
          </div>
        ) : null}
      </div>
    </div>
  )
}
